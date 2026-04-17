/**
 * InfraNodus — User model using MongoDB (Azure Cosmos DB for MongoDB).
 */

var bcrypt = require('bcrypt-nodejs')
var uuid = require('node-uuid')
var db = require('./db/mongodb')
var options = require('../options')
var validate = require('../lib/middleware/validate')
var chargebee = require('chargebee')

module.exports = User

function User(obj) {
    for (var key in obj) {
        this[key] = obj[key]
    }
}

User.prototype.save = function(fn) {
    var user = this
    user.hashPassword(function(err) {
        if (err) return fn(err)
        user.update(fn)
    })
}

User.prototype.hashPassword = function(fn) {
    var user = this
    bcrypt.genSalt(12, function(err, salt) {
        if (err) return fn(err)
        user.salt = salt
        bcrypt.hash(user.pepper, salt, null, function(err, hash) {
            if (err) return fn(err)
            user.pepper = hash
            fn()
        })
    })
}

User.prototype.update = function(fn) {
    var user = this
    var user_uid = uuid.v1()

    var doc = {
        uid: user_uid,
        name: user.name,
        substance: user.name,
        portal: user.portal,
        salt: user.salt,
        pepper: user.pepper,
        fullscan: options.settings.fullscan,
        fullview: options.settings.fullview,
        morphemes: options.settings.morphemes,
        hashnodes: options.settings.hashnodes,
        maxnodes: options.settings.max_nodes,
        inlanguage: options.settings.inlanguage,
        label_threshold: options.settings.label_threshold,
        palette: options.settings.palette,
    }

    db.getDb(function(err, mdb) {
        if (err) return fn(err)
        mdb.collection('users').insertOne(doc, function(err) {
            if (err) return fn(err)
            console.log('User created. UID: ' + user_uid)

            var statements = options.defaultstatements
            if (statements) {
                var entries = require('../routes/entries')
                var addToContexts = ['help']
                validate.getContextID(user_uid, addToContexts, function(result) {
                    var contexts = result
                    var req = {
                        body: { entry: { body: '' }, context: 'help' },
                        contextids: contexts,
                        internal: 1,
                    }
                    var res = { locals: { user: { uid: user_uid, name: user.name, fullscan: options.settings.fullscan } } }
                    for (var key in statements) {
                        if (statements.hasOwnProperty(key)) {
                            req.body.entry.body = statements[key]
                            entries.submit(req, res)
                        }
                    }
                    fn()
                })
            } else {
                fn()
            }
        })
    })
}

User.authenticate = function(name, pass, fn) {
    User.getByName(name, function(err, user) {
        if (err) return fn(err)
        if (!user || !user.uid) return fn()
        bcrypt.hash(pass, user.salt, null, function(err, hash) {
            if (err) return fn(err)
            if (hash == user.pepper) return fn(null, user)
            fn()
        })
    })
}

User.getByName = function(name, fn) {
    User.getId(name, function(err, uid) {
        if (err) return fn(err)
        User.get(uid, fn)
    })
}

User.get = function(uid, fn) {
    if (!uid) return fn(null, {})
    db.getDb(function(err, mdb) {
        if (err) { err.type = 'neo4j'; return fn(err) }
        mdb.collection('users').findOne({ uid: uid }, function(err, doc) {
            if (err) { err.type = 'neo4j'; return fn(err) }
            fn(null, new User(doc || {}))
        })
    })
}

User.getByNameEmail = function(name, email, fn) {
    User.getIdNameEmail(name, email, function(err, uid) {
        if (err) return fn(err)
        User.get(uid, fn)
    })
}

User.getIdNameEmail = function(name, email, fn) {
    if (name) name = validate.sanitize(name)
    if (email) email = validate.sanitize(email)

    var query = {}
    if (name && email) {
        query = { substance: name, portal: email }
    } else if (name) {
        query = { substance: name }
    } else if (email) {
        query = { portal: email }
    }

    db.getDb(function(err, mdb) {
        if (err) { err.type = 'neo4j'; return fn(err) }
        mdb.collection('users').findOne(query, { projection: { uid: 1 } }, function(err, doc) {
            if (err) { err.type = 'neo4j'; return fn(err) }
            fn(null, doc ? doc.uid : null)
        })
    })
}

User.getId = function(name, fn) {
    name = validate.sanitize(name)
    db.getDb(function(err, mdb) {
        if (err) { err.type = 'neo4j'; return fn(err) }
        mdb.collection('users').findOne({ substance: name }, { projection: { uid: 1 } }, function(err, doc) {
            if (err) { err.type = 'neo4j'; return fn(err) }
            fn(null, doc ? doc.uid : null)
        })
    })
}

User.modifySettings = function(user_id, fullscan, fullview, morphemes, hashnodes, maxnodes, inlanguage, palette, background, midi, voice_continues, abstract, label_threshold, topnodes, mentions, customization, stopwords, callback) {
    inlanguage = validate.sanitize(inlanguage)
    palette = validate.sanitize(palette)
    background = validate.sanitize(background)
    midi = validate.sanitize(midi)
    voice_continues = validate.sanitize(voice_continues)
    abstract = validate.sanitize(abstract)
    label_threshold = validate.sanitize(label_threshold)
    topnodes = validate.sanitize(topnodes)
    stopwords = validate.sanitize(stopwords).replace(/["'\\]/g, '')
    fullscan = validate.sanitize(fullscan)
    fullview = validate.sanitize(fullview)
    maxnodes = validate.sanitize(maxnodes)
    mentions = validate.sanitize(mentions)
    customization = validate.sanitize(customization)
    morphemes = validate.sanitize(morphemes)

    db.getDb(function(err, mdb) {
        if (err) { err.type = 'neo4j'; return callback(err) }
        mdb.collection('users').updateOne(
            { uid: user_id },
            { $set: { fullscan: fullscan, fullview: fullview, hashnodes: hashnodes, maxnodes: maxnodes, morphemes: morphemes, inlanguage: inlanguage, palette: palette, background: background, midi: midi, voice_continues: voice_continues, abstract: abstract, label_threshold: label_threshold, topnodes: topnodes, mentions: mentions, customization: customization, stopwords: stopwords } },
            function(err, result) {
                if (err) { err.type = 'neo4j'; return callback(err) }
                callback(null, result)
            }
        )
    })
}

User.modifyPassword = function(name, pass, callback) {
    User.getByName(name, function(err, user) {
        if (err) return callback(err)
        if (!user || !user.uid) return callback(new Error('User not found'))
        bcrypt.hash(pass, user.salt, null, function(err, hash) {
            if (err) return callback(err)
            db.getDb(function(err, mdb) {
                if (err) return callback(err)
                mdb.collection('users').updateOne({ uid: user.uid }, { $set: { pepper: hash } }, function(err, result) {
                    if (err) { err.type = 'neo4j'; return callback(err) }
                    callback(null, result)
                })
            })
        })
    })
}

User.checkSubscription = function(sub_id, callback) {
    if (options.chargebee && options.chargebee.site && options.chargebee.api_key) {
        chargebee.configure({ site: options.chargebee.site, api_key: options.chargebee.api_key })
        chargebee.subscription.retrieve(validate.sanitize(sub_id)).request(function(error, result) {
            if (error) callback(error)
            else callback(null, result)
        })
    }
}

User.checkHostedPage = function(hosted_page, callback) {
    if (options.chargebee && options.chargebee.site && options.chargebee.api_key) {
        chargebee.configure({ site: options.chargebee.site, api_key: options.chargebee.api_key })
        chargebee.hosted_page.retrieve(validate.sanitize(hosted_page)).request(function(error, result) {
            if (error) callback(error)
            else callback(null, result.hosted_page)
        })
    }
}

User.prototype.toJSON = function() {
    return { uid: this.uid, name: this.name }
}
