/**
 * InfraNodus — Entry model using MongoDB (Azure Cosmos DB for MongoDB).
 */

var uuid = require('node-uuid')
var db = require('./db/mongodb')
var CypherQuery = require('./db/neo4j')
var Instruments = require('./tools/instruments.js')
var async = require('async')
var options = require('../options')

module.exports = Entry

function Entry(obj) {
    for (var key in obj) {
        this[key] = obj[key]
    }
}

Entry.prototype.savetrans = function(fn) {
    var user = { name: this.by_name, uid: this.by_uid }
    var fullscan = this.fullscan
    var addmentions = this.addmentions
    var statements = this.statements
    var contexts = this.contexts
    var gapscan = fullscan == '1' ? 1 : null

    CypherQuery.addStatement(user, statements, contexts, addmentions, gapscan, function(err, result) {
        fn(err, result)
    })
}

Entry.getRange = function(receiver, perceiver, contexts, fn) {
    console.log('making request to db')

    db.getDb(function(err, mdb) {
        if (err) { err.type = 'neo4j'; return fn(err) }

        // Build context and permission filter
        buildStatementQuery(mdb, receiver, perceiver, contexts, function(err, docs) {
            if (err) { err.type = 'neo4j'; return fn(err) }
            fn(null, docs)
        })
    })
}

function buildStatementQuery(mdb, receiver, perceiver, contexts, fn) {
    var isSelfView = (receiver == perceiver && receiver !== '') || (receiver !== '' && perceiver === '')

    // Resolve context names to UIDs
    var userIdForContexts = isSelfView ? receiver : perceiver
    if (!userIdForContexts) return fn(null, [])

    var ctxFilter = { by: userIdForContexts }
    if (!isSelfView) ctxFilter.public = '1'

    if (contexts.length > 0 && contexts[0]) {
        ctxFilter.name = { $in: contexts }
    }

    mdb.collection('contexts').find(ctxFilter, { projection: { uid: 1 } }).toArray(function(err, ctxDocs) {
        if (err) return fn(err)
        if (!ctxDocs || ctxDocs.length == 0) return fn(null, [])

        var ctxUids = ctxDocs.map(function(c) { return c.uid })

        mdb.collection('statements').find(
            { userId: userIdForContexts, contextIds: { $in: ctxUids } },
            { sort: { timestamp: 1 } }
        ).toArray(function(err, docs) {
            if (err) return fn(err)
            fn(null, docs || [])
        })
    })
}

Entry.getLDA = function(receiver, perceiver, contexts, LDA_type, fn) {
    Entry.getRange(receiver, perceiver, contexts, function(err, statements) {
        if (err) return fn(err)

        var lda = require('lda')
        var natural = require('natural')
        var nounInflector = new natural.NounInflector()

        var documents = []
        for (var i = 0; i < statements.length; i++) {
            documents.push(statements[i].text)
        }

        var result
        if (LDA_type == 'topics') result = lda(documents, 4, 3, null, null, null, 123)
        else if (LDA_type == 'terms') result = lda(documents, 1, 4, null, null, null, 123)
        else result = lda(documents, 4, 3, null, null, null, 123)

        for (var i = 0; i < result.length; i++) {
            for (var j = 0; j < result[i].length; j++) {
                if (result[i][j].term != 'people') {
                    result[i][j].term = nounInflector.singularize(result[i][j].term)
                }
            }
        }

        fn(null, result)
    })
}

Entry.getConnectedContexts = function(receiver, perceiver, keywords, fn) {
    var searchwords = keywords[0].keywords.split(' ').filter(Boolean)
    if (searchwords.length == 0) return fn(null, [])

    var isSelfView = (receiver == perceiver && receiver !== '') || (receiver !== '' && perceiver === '')
    var userIdForContexts = isSelfView ? receiver : perceiver

    db.getDb(function(err, mdb) {
        if (err) { err.type = 'neo4j'; return fn(err) }

        // For each keyword find context UIDs where it appears
        var tasks = searchwords.map(function(word) {
            return new Promise(function(resolve, reject) {
                mdb.collection('relationships').distinct('context', {
                    $or: [{ from: word }, { to: word }],
                    user: userIdForContexts,
                }, function(err, ctxUids) {
                    if (err) reject(err)
                    else resolve(ctxUids)
                })
            })
        })

        Promise.all(tasks).then(function(sets) {
            // Intersect all sets
            var shared = sets.reduce(function(a, b) {
                return a.filter(function(uid) { return b.indexOf(uid) >= 0 })
            })

            if (shared.length == 0) return fn(null, [])

            var ctxFilter = { uid: { $in: shared }, by: userIdForContexts }
            if (!isSelfView) ctxFilter.public = '1'

            mdb.collection('contexts').find(ctxFilter).toArray(function(err, ctxDocs) {
                if (err) { err.type = 'neo4j'; return fn(err) }
                fn(null, ctxDocs || [])
            })
        }).catch(function(err) {
            err.type = 'neo4j'; fn(err)
        })
    })
}

Entry.getConnectedContextsOut = function(receiver, perceiver, keywords, fn) {
    var searchwords = keywords[0].keywords.split(' ').filter(Boolean)
    if (searchwords.length == 0) return fn(null, [])

    db.getDb(function(err, mdb) {
        if (err) { err.type = 'neo4j'; return fn(err) }

        var tasks = searchwords.map(function(word) {
            return new Promise(function(resolve, reject) {
                mdb.collection('relationships').distinct('context', {
                    $or: [{ from: word }, { to: word }],
                }, function(err, ctxUids) {
                    if (err) reject(err)
                    else resolve(ctxUids)
                })
            })
        })

        Promise.all(tasks).then(function(sets) {
            var shared = sets.reduce(function(a, b) {
                return a.filter(function(uid) { return b.indexOf(uid) >= 0 })
            })
            if (shared.length == 0) return fn(null, [])

            mdb.collection('contexts').find({ uid: { $in: shared }, public: '1' }).toArray(function(err, ctxDocs) {
                if (err) { err.type = 'neo4j'; return fn(err) }

                // Fetch usernames — join with users collection
                var userIds = ctxDocs.map(function(c) { return c.by })
                mdb.collection('users').find({ uid: { $in: userIds } }, { projection: { uid: 1, name: 1 } }).toArray(function(err, userDocs) {
                    if (err) return fn(null, ctxDocs)
                    var userMap = {}
                    userDocs.forEach(function(u) { userMap[u.uid] = u.name })
                    var result = ctxDocs.map(function(c) {
                        return [c, userMap[c.by] || '']
                    })
                    fn(null, result)
                })
            })
        }).catch(function(err) {
            err.type = 'neo4j'; fn(err)
        })
    })
}

Entry.getNodes = function(receiver, perceiver, contexts, fullview, showcontexts, res, req, fn) {
    var isSelfView = (receiver == perceiver && receiver !== '') || (receiver !== '' && perceiver === '')

    var contexts_map = []
    if (!res.locals.contextslist) {
        if (req.contextids) {
            for (var i = 0; i < req.contextids.length; i++) {
                contexts_map[i] = [req.contextids[i].name, req.contextids[i].uid]
            }
        }
    } else {
        contexts_map = res.locals.contextslist
    }

    var maxnodes = options.settings.max_nodes
    if (req.query && req.query.maxnodes && isInt(req.query.maxnodes)) {
        maxnodes = parseInt(req.query.maxnodes)
    } else if (res.locals.user && res.locals.user.maxnodes) {
        maxnodes = res.locals.user.maxnodes
    }

    function isInt(v) {
        return !isNaN(v) && (function(x) { return (x | 0) === x })(parseFloat(v))
    }

    db.getDb(function(err, mdb) {
        if (err) { err.type = 'neo4j'; return fn(err) }

        // Determine which context UIDs to query
        var ctxUids = []
        if (contexts.length > 0 && contexts[0]) {
            for (var u = 0; u < contexts.length; u++) {
                var uid = Instruments.findInArray(contexts_map, contexts[u])
                if (uid) ctxUids.push(uid)
            }
        } else {
            for (var c = 0; c < contexts_map.length; c++) {
                if (contexts_map[c][1] && contexts_map[c][1] != 'undefined') {
                    ctxUids.push(contexts_map[c][1])
                }
            }
        }

        if (ctxUids.length == 0) {
            return fn(null, { nodes: [], edges: [] })
        }

        var relFilter = { context: { $in: ctxUids } }
        if (!fullview) {
            relFilter.$or = [{ gapscan: '2' }, { gapscan: null }]
        }

        mdb.collection('relationships').find(relFilter).toArray(function(err, rels) {
            if (err) { err.type = 'neo4j'; return fn(err) }

            // Build nodes_object rows in same format as original Neo4j result:
            // [source_id, source_name, target_id, target_name, edge_id, context_id, statement_id, weight]
            var nodes_object = rels.map(function(r) {
                return [
                    r.from,   // 0: source_id (using name as ID for concepts)
                    r.from,   // 1: source_name
                    r.to,     // 2: target_id
                    r.to,     // 3: target_name
                    r.uid,    // 4: edge_id
                    r.context, // 5: context_id
                    r.statement, // 6: statement_id
                    r.weight,    // 7: weight
                ]
            })

            // Also add context-as-node rows if showcontexts is requested
            var ctxNodeOps = Promise.resolve([])
            if (showcontexts) {
                ctxNodeOps = new Promise(function(resolve) {
                    var atFilter = { user: isSelfView ? receiver : perceiver }
                    if (ctxUids.length > 0) atFilter.context = { $in: ctxUids }
                    mdb.collection('relationships').find(atFilter).toArray(function(err, atRels) {
                        if (err) return resolve([])
                        var ctxRows = atRels.map(function(r) {
                            return [r.from, r.from, r.context, r.context, null, r.context, r.statement, r.weight || 1]
                        })
                        resolve(ctxRows)
                    })
                })
            }

            ctxNodeOps.then(function(ctxRows) {
                nodes_object = nodes_object.concat(ctxRows)
                processGraph(nodes_object, contexts_map, ctxUids, maxnodes, res, req, fn)
            })
        })
    })
}

function processGraph(nodes_object, contexts_map, ctxUids, maxnodes, res, req, fn) {
    var g = { nodes: [], edges: [] }

    var stopwords_custom = ''
    if (res.locals.vieweduser && res.locals.vieweduser.stopwords) {
        stopwords_custom = res.locals.vieweduser.stopwords
    } else if (!res.locals.viewuser && res.locals.user && res.locals.user.stopwords) {
        stopwords_custom = res.locals.user.stopwords
    }

    var stopwords_add = stopwords_custom.split(/[\s,;\t\n]+/)
    for (var i = 0; i < stopwords_add.length; i++) {
        if (stopwords_add[i].charAt(0) == '-') stopwords_add[i] = ''
    }

    var sorted = []

    for (var i = 0; i < nodes_object.length; i++) {
        if (ctxUids.indexOf(nodes_object[i][5]) >= 0) {
            var indexsource = -1
            var indextarget = -1
            for (var j = 0; j < sorted.length; j++) {
                if (sorted[j].name == nodes_object[i][1]) indexsource = j
            }
            if (!nodes_object[i][7]) nodes_object[i][7] = 3
            if (indexsource == -1) {
                if (stopwords_add.indexOf(nodes_object[i][1]) == -1) {
                    sorted.push({ val: nodes_object[i][0], name: nodes_object[i][1], count: parseInt(nodes_object[i][7]) })
                }
            } else {
                if (sorted[indexsource].val == nodes_object[i][0]) {
                    sorted[indexsource].count += parseInt(nodes_object[i][7])
                }
            }
            for (var j = 0; j < sorted.length; j++) {
                if (sorted[j].name == nodes_object[i][3]) indextarget = j
            }
            if (indextarget == -1) {
                if (stopwords_add.indexOf(nodes_object[i][3]) == -1) {
                    sorted.push({ val: nodes_object[i][2], name: nodes_object[i][3], count: parseInt(nodes_object[i][7]) })
                }
            } else {
                if (sorted[indextarget].val == nodes_object[i][2]) {
                    sorted[indextarget].count += parseInt(nodes_object[i][7])
                }
            }
        }
    }

    sorted.sort(function(a, b) { return b.count - a.count })
    sorted = sorted.slice(0, maxnodes)

    var edges_added = {}

    for (var i = 0; i < nodes_object.length; i++) {
        if (ctxUids.indexOf(nodes_object[i][5]) >= 0) {
            var sourcein = null, targetin = null
            for (var j = 0; j < sorted.length; j++) {
                if (sorted[j].val == nodes_object[i][0]) sourcein = 1
                if (sorted[j].val == nodes_object[i][2]) targetin = 1
            }
            if (sourcein && targetin) {
                if (!nodes_object[i][7]) nodes_object[i][7] = 3
                if (!nodes_object[i][4]) nodes_object[i][4] = 'context' + uuid.v1()

                g.nodes.push({ id: nodes_object[i][0], label: nodes_object[i][1] })
                g.nodes.push({ id: nodes_object[i][2], label: nodes_object[i][3] })

                var ctxName = ''
                for (var c = 0; c < contexts_map.length; c++) {
                    if (contexts_map[c][1] == nodes_object[i][5]) { ctxName = contexts_map[c][0]; break }
                }
                if (!ctxName) ctxName = nodes_object[i][5]

                var edgeKey = nodes_object[i][0] + '-' + nodes_object[i][2]
                if (edges_added[edgeKey]) {
                    if (edges_added[edgeKey].context_matrix[ctxName]) {
                        edges_added[edgeKey].context_matrix[ctxName][nodes_object[i][6]] = parseInt(nodes_object[i][7])
                        edges_added[edgeKey].weight += parseInt(nodes_object[i][7])
                    } else {
                        edges_added[edgeKey].context_matrix[ctxName] = {}
                        edges_added[edgeKey].context_matrix[ctxName][nodes_object[i][6]] = parseInt(nodes_object[i][7])
                        edges_added[edgeKey].weight += parseInt(nodes_object[i][7])
                    }
                } else {
                    var ctxStmt = {}
                    ctxStmt[ctxName] = {}
                    ctxStmt[ctxName][nodes_object[i][6]] = nodes_object[i][7]
                    edges_added[edgeKey] = {
                        source: nodes_object[i][0],
                        target: nodes_object[i][2],
                        id: nodes_object[i][4],
                        context_matrix: ctxStmt,
                        weight: parseInt(nodes_object[i][7]),
                    }
                }
            }
        }
    }

    g.nodes = Instruments.uniqualizeArray(g.nodes, JSON.stringify)
    g.nodes.sort(function(a, b) { return a.label < b.label ? -1 : a.label > b.label ? 1 : 0 })
    for (var key in edges_added) g.edges.push(edges_added[key])

    fn(null, g)
}
