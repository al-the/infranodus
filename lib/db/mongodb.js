var MongoClient = require('mongodb').MongoClient
var options = require('../../options')

var _db = null
var _client = null

function getDb(callback) {
    if (_db) return callback(null, _db)

    MongoClient.connect(options.mongodbUri, { useUnifiedTopology: true }, function(err, client) {
        if (err) return callback(err)
        _client = client
        _db = client.db(options.mongodbName || 'infranodus')
        ensureIndexes(_db, function(idxErr) {
            if (idxErr) console.warn('Index creation warning:', idxErr)
            callback(null, _db)
        })
    })
}

function ensureIndexes(db, callback) {
    var tasks = [
        db.collection('users').createIndex({ uid: 1 }, { unique: true }),
        db.collection('users').createIndex({ substance: 1 }),
        db.collection('users').createIndex({ portal: 1 }),
        db.collection('contexts').createIndex({ uid: 1 }, { unique: true }),
        db.collection('contexts').createIndex({ by: 1, name: 1 }),
        db.collection('statements').createIndex({ uid: 1 }, { unique: true }),
        db.collection('statements').createIndex({ userId: 1 }),
        db.collection('statements').createIndex({ contextIds: 1 }),
        db.collection('relationships').createIndex({ context: 1, gapscan: 1 }),
        db.collection('relationships').createIndex({ statement: 1 }),
        db.collection('relationships').createIndex({ user: 1 }),
        db.collection('relationships').createIndex({ from: 1 }),
        db.collection('relationships').createIndex({ to: 1 }),
    ]

    Promise.all(tasks)
        .then(function() { callback(null) })
        .catch(function(err) { callback(err) })
}

module.exports = { getDb: getDb }
