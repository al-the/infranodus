/**
 * InfraNodus — MongoDB implementation of the graph statement builder.
 * Replaces the original Neo4j / Cypher implementation.
 */

var uuid = require('node-uuid')
var db = require('./mongodb')
var options = require('../../options')

module.exports = CypherQuery

function CypherQuery() {}

CypherQuery.addStatement = function(user, statements, contexts, addmentions, gapscan, callback) {
    var narrativeScanWeight = 3
    var landscapeScanWeight = 3
    var scanGap = 4

    gapscan = gapscan || null

    var params = {
        userId: user.uid,
        contextNames: [],
        statements: [],
        timestamp: '',
    }

    params['timestamp'] = statements[0].timestamp

    for (var i = 0; i < statements.length; i++) params['statements'].push(statements[i])
    for (var i = 0; i < contexts.length; i++) params['contextNames'].push(contexts[i])

    // ---- Build concept relations (same logic as before) ----

    var mentions_exist = []
    var concepts_exist = []

    for (var sindex = 0; sindex < params['statements'].length; sindex++) {
        var timestamp = params['statements'][sindex]['timestamp']
        var concepts_added = []
        var mentions_added = []
        var mentions = params['statements'][sindex]['mentions'] || []
        var concepts = params['statements'][sindex]['concepts'] || []

        params['statements'][sindex]['uniqueconcepts'] = []
        params['statements'][sindex]['conceptsRelations'] = []
        params['statements'][sindex]['mentionsRelations'] = []

        if (concepts.length > 0) {
            for (var index = 0; index < concepts.length; index++) {
                if (index > 0) {
                    var minusOne = index - 1
                    if (concepts[minusOne] !== concepts[index]) {
                        for (var indx = 0; indx < contexts.length; indx++) {
                            if (mentions.length == 0 || (mentions.length > 0 && addmentions != 'link')) {
                                params['statements'][sindex]['conceptsRelations'].push({
                                    from: concepts[minusOne],
                                    to: concepts[index],
                                    context: contexts[indx].uid,
                                    statement: params['statements'][sindex]['uid'],
                                    user: user.uid,
                                    timestamp: timestamp + index,
                                    uid: uuid.v1(),
                                    gapscan: '2',
                                    weight: narrativeScanWeight,
                                })
                            }
                        }
                    }

                    if (gapscan) {
                        if (mentions.length == 0 || (mentions.length > 0 && addmentions != 'link')) {
                            var leftGap = index + 1 - scanGap
                            if (leftGap < 0) leftGap = 0
                            for (var indexGap = leftGap; indexGap < index - 1; indexGap++) {
                                var weightInGap = landscapeScanWeight + 1 - (index - indexGap)
                                if (concepts[indexGap] !== concepts[index]) {
                                    for (var indx = 0; indx < contexts.length; indx++) {
                                        params['statements'][sindex]['conceptsRelations'].push({
                                            from: concepts[indexGap],
                                            to: concepts[index],
                                            context: contexts[indx].uid,
                                            statement: params['statements'][sindex]['uid'],
                                            user: user.uid,
                                            timestamp: timestamp + index,
                                            uid: uuid.v1(),
                                            gapscan: scanGap,
                                            weight: weightInGap,
                                        })
                                    }
                                }
                            }
                        }
                    }
                }

                if (concepts_added.indexOf(concepts[index]) == -1) {
                    concepts_exist[sindex] = index + 1
                    concepts_added.push(concepts[index])
                    params['statements'][sindex]['uniqueconcepts'].push(concepts[index])

                    for (var indx = 0; indx < contexts.length; indx++) {
                        if (mentions.length > 0) {
                            for (var m = 0; m < mentions.length; m++) {
                                var mentionTarget = (addmentions == 'remove' || addmentions == 'link')
                                    ? mentions[m].substring(1) : mentions[m]
                                params['statements'][sindex]['mentionsRelations'].push({
                                    from: concepts[index],
                                    to: mentionTarget,
                                    context: contexts[indx].uid,
                                    statement: params['statements'][sindex]['uid'],
                                    user: user.uid,
                                    timestamp: timestamp + index,
                                    uid: uuid.v1(),
                                    gapscan: '1',
                                    weight: narrativeScanWeight,
                                })
                            }
                        }
                    }
                }
            }

            if (concepts.length == 1 || params['statements'][sindex]['conceptsRelations'].length == 0) {
                for (var nindx = 0; nindx < contexts.length; nindx++) {
                    params['statements'][sindex]['conceptsRelations'].push({
                        from: concepts[0],
                        to: concepts[0],
                        context: contexts[nindx].uid,
                        statement: params['statements'][sindex]['uid'],
                        user: user.uid,
                        timestamp: timestamp,
                        uid: uuid.v1(),
                        gapscan: '2',
                        weight: narrativeScanWeight,
                    })
                }
            }
        }

        if (params['statements'][sindex]['mentions'] && params['statements'][sindex]['mentions'].length > 0) {
            params['statements'][sindex]['uniquementions'] = []

            for (var puka = 0; puka < params['statements'][sindex]['mentions'].length; puka++) {
                if (addmentions == 'remove' || addmentions == 'link') {
                    params['statements'][sindex]['mentions'][puka] = params['statements'][sindex]['mentions'][puka].substring(1)
                }

                for (var iter = 0; iter < puka; iter++) {
                    if (params['statements'][sindex]['mentions'][iter] !== params['statements'][sindex]['mentions'][puka]) {
                        for (var indx = 0; indx < contexts.length; indx++) {
                            params['statements'][sindex]['mentionsRelations'].push({
                                from: params['statements'][sindex]['mentions'][iter],
                                to: params['statements'][sindex]['mentions'][puka],
                                context: contexts[indx].uid,
                                statement: params['statements'][sindex]['uid'],
                                user: user.uid,
                                timestamp: timestamp + puka,
                                uid: uuid.v1(),
                                gapscan: '1',
                                weight: narrativeScanWeight,
                            })
                        }
                    }
                }

                if (mentions_added.indexOf(params['statements'][sindex]['mentions'][puka]) == -1) {
                    mentions_exist[sindex] = puka + 1
                    mentions_added.push(params['statements'][sindex]['mentions'][puka])
                    params['statements'][sindex]['uniquementions'].push(params['statements'][sindex]['mentions'][puka])
                }
            }

            if (params['statements'][sindex]['mentions'].length == 1 || params['statements'][sindex]['mentionsRelations'].length == 0) {
                for (var mindx = 0; mindx < contexts.length; mindx++) {
                    params['statements'][sindex]['mentionsRelations'].push({
                        from: params['statements'][sindex]['mentions'][0],
                        to: params['statements'][sindex]['mentions'][0],
                        context: contexts[mindx].uid,
                        statement: params['statements'][sindex]['uid'],
                        user: user.uid,
                        timestamp: timestamp,
                        uid: uuid.v1(),
                        gapscan: '1',
                        weight: narrativeScanWeight,
                    })
                }
            }
        }
    }

    // ---- Write to MongoDB ----

    db.getDb(function(err, mdb) {
        if (err) return callback(null, { error: err, uid: null })

        var contextTimestamp = params['timestamp']

        // Upsert contexts
        var contextOps = params['contextNames'].map(function(ctx) {
            return {
                updateOne: {
                    filter: { uid: ctx.uid },
                    update: { $setOnInsert: { uid: ctx.uid, name: ctx.name, by: params['userId'], timestamp: contextTimestamp, public: '0' } },
                    upsert: true,
                },
            }
        })

        var doContexts = contextOps.length > 0
            ? new Promise(function(res, rej) {
                mdb.collection('contexts').bulkWrite(contextOps, function(e) { e ? rej(e) : res() })
            })
            : Promise.resolve()

        doContexts.then(function() {
            // Insert statements and their relationships
            var statementDocs = []
            var relationshipDocs = []

            for (var sindex = 0; sindex < params['statements'].length; sindex++) {
                var st = params['statements'][sindex]
                var ctxIds = params['contextNames'].map(function(c) { return c.uid })

                statementDocs.push({
                    uid: st.uid,
                    name: st.name,
                    text: st.text,
                    timestamp: st.timestamp,
                    userId: params['userId'],
                    contextIds: ctxIds,
                })

                var allRels = (st.conceptsRelations || []).concat(st.mentionsRelations || [])
                for (var r = 0; r < allRels.length; r++) {
                    relationshipDocs.push(allRels[r])
                }
            }

            var insertStatements = statementDocs.length > 0
                ? new Promise(function(res, rej) {
                    mdb.collection('statements').insertMany(statementDocs, { ordered: false }, function(e) { e ? rej(e) : res() })
                })
                : Promise.resolve()

            var insertRels = relationshipDocs.length > 0
                ? new Promise(function(res, rej) {
                    mdb.collection('relationships').insertMany(relationshipDocs, { ordered: false }, function(e) { e ? rej(e) : res() })
                })
                : Promise.resolve()

            return Promise.all([insertStatements, insertRels])
        }).then(function() {
            var firstUid = params['statements'].length > 0 ? params['statements'][0].uid : null
            callback(null, { uid: firstUid })
        }).catch(function(e) {
            console.error('MongoDB addStatement error:', e)
            callback(null, { error: e, uid: null })
        })
    })
}
