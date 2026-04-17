// Import library to generate UID for statements
var uuid = require('node-uuid')

// Import string processing libraries
var S = require('string')

// Import Hashtag extraction library
var FlowdockText = require('flowdock-text')

// Options for Stack Overflow
var options = require('../../options')

// Stemming module initialization
var natural = require('natural')
var tokenizer = require('wink-tokenizer')
var myTokenizer = tokenizer()

// Lemmatizer module initialization

// Call French Lemmer
var NlpjsTFr = require('nlp-js-tools-french')

var lemmerEng = null
var lemmerRus = null
var lemmerGer = null

try {
    const Morphy = require('phpmorphy-locutus').default
    lemmerEng = new Morphy('en', {
        storage: Morphy.STORAGE_MEM,
        predict_by_suffix: true,
        predict_by_db: true,
        graminfo_as_text: true,
        use_ancodes_cache: false,
        resolve_ancodes: Morphy.RESOLVE_ANCODES_AS_TEXT,
    })
    lemmerRus = new Morphy('ru', {
        storage: Morphy.STORAGE_MEM,
        predict_by_suffix: true,
        predict_by_db: true,
        graminfo_as_text: true,
        use_ancodes_cache: false,
        resolve_ancodes: Morphy.RESOLVE_ANCODES_AS_TEXT,
    })
    lemmerGer = new Morphy('de', {
        storage: Morphy.STORAGE_MEM,
        predict_by_suffix: true,
        predict_by_db: true,
        graminfo_as_text: true,
        use_ancodes_cache: false,
        resolve_ancodes: Morphy.RESOLVE_ANCODES_AS_TEXT,
    })
} catch (e) {
    console.log('phpmorphy-locutus unavailable, lemmatization disabled:', e.message)
}

// Language detection
var LanguageDetect = require('languagedetect')
var lngDetector = new LanguageDetect()

var mdb = require('../db/mongodb')

function parseField(field) {
    return field.split(/\[|\]/).filter(function(s) {
        return s
    })
}

function getField(req, field) {
    var val = req.body
    field.forEach(function(prop) {
        val = val[prop]
    })
    return val
}

function uniques(a) {
    if (a.length === 1) {
        return a
    }
    var seen = {}
    var out = []
    var len = a.length
    var j = 0
    for (var i = 0; i < len; i++) {
        var item = a[i]
        if (seen[item] !== 1 && item.length > 0) {
            seen[item] = 1
            out[j++] = item
        }
    }
    return out
}

// AUXILIARY FUNCTIONS

// Function to extract hashtags from any input

function extractHashtags(statement) {
    var hashtags = FlowdockText.extractHashtags(statement)

    // Convert them to lowercase
    for (var i = 0; i < hashtags.length; i++) {
        hashtags[i] = hashtags[i].toLowerCase()
    }
    return hashtags
}

// Function to extract concepts from any input

function extractConcepts(
    statement,
    morphemes,
    hashnodes,
    stopwords_custom,
    res
) {
    // Get rid of the @contexts in the statement
    statement = statement.replace(/@\S+/g, '')

    // Get rid of the single and double quotes in the statement
    //statement = statement.replace(/['"]+/g, '');

    // Single quotation mark
    statement = statement.replace(/[‘’]+/g, ' ')

    // Get rid of the links in the statement - we need only hashtags and concepts
    statement = statement.replace(/(?:https?|ftp):\/\/\S+/g, '')

    console.log('We are processing: ' + statement)

    // Detect language
    // Rather fast-patched way to deal with a case when language is not detected TODO: fix

    lngDetected = lngDetector.detect(statement, 4)

    // console.log(lngDetected);

    // A rather complicated way of detecting language because language detect module works like shit
    var lng = 'undefined'

    var lngmarker = ''

    var inlanguage = 'auto'

    if (res.locals.user) {
        inlanguage = res.locals.user.inlanguage
        if (!inlanguage) {
            inlanguage = 'auto'
        }
    }

    if (
        typeof lngDetected !== 'undefined' &&
        lngDetected.length > 0 &&
        inlanguage.length != 2
    ) {
        if (
            lngDetected[0][0] == 'russian' ||
            lngDetected[0][0] == 'macedonian' ||
            lngDetected[0][0] == 'slovak' ||
            lngDetected[0][0] == 'serbian'
        ) {
            lng = 'russian'
            lngmarker = 'detected'
        } else if (lngDetected[0][0] == 'english') {
            lng = 'english'
            lngmarker = 'detected'
        } else {
            if (
                lngDetected[0][0] == 'german' ||
                lngDetected[0][0] == 'french' ||
                lngDetected[0][0] == 'spanish'
            ) {
                // If we detect one of the languages above on top of the list, mark it as default language
                if (lngmarker != 'detected') {
                    lng = lngDetected[0][0]
                    lngmarker = 'detected'
                }
            } else {
                lng = 'english'
                lngmarker = 'detected'
            }
        }
    } else {
        if (inlanguage == 'fr') {
            lng = 'french'
        } else if (inlanguage == 'de') {
            lng = 'german'
        } else if (inlanguage == 'ru') {
            lng = 'russian'
        } else if (inlanguage == 'en') {
            lng = 'english'
        } else if (inlanguage == 'ep') {
            lng = 'penglish'
        } else if (inlanguage == 'pp') {
            lng = 'pportugese'
        } else if (inlanguage == 'sp') {
            lng = 'pspanish'
        } else if (inlanguage == 'vp') {
            lng = 'pswedish'
        } else if (inlanguage == 'zz') {
            lng = 'none'
        } else {
            lng = 'none'
        }
        lngmarker = 'detected'
    }
    // Get a list of stopwords from settings
    // TODO load stopword corrections from user's settings

    var stopwords = options.stopwords_en

    if (lng == 'none') {
        stopwords = []
    }

    if (lng == 'russian') {
        stopwords = options.stopwords_ru
    }

    if (lng == 'german') {
        stopwords = options.stopwords_de
    }

    if (lng == 'french') {
        stopwords = options.stopwords_fr
    }

    if (lng == 'pspanish' || lng == 'spanish') {
        stopwords = options.stopwords_es
    }

    if (lng == 'pswedish' || lng == 'swedish') {
        stopwords = options.stopwords_sv
    }

    if (lng == 'pportugese' || lng == 'portugese') {
        stopwords = options.stopwords_pt
    }

    // Get the custom stopwords
    // This function splits a string separated by , space or new line and converts it into an array
    var stopwords_add = stopwords_custom.split(/[\s,;\t\n]+/)

    var stopwords_remove = ['']

    for (var i = 0; i < stopwords_add.length; i++) {
        if (stopwords_add[i].charAt(0) == '-') {
            stopwords_remove.push(stopwords_add[i].substring(1))
            stopwords_add[i] = ''
        }
    }

    // Then add those words into the stopwords list
    stopwords = stopwords.concat(stopwords_add)

    // Remove those stopwords from the main list that were in the remove list
    stopwords = stopwords.filter(function(el) {
        return stopwords_remove.indexOf(el) < 0
    })

    // #Hashtags should not be lemmatized? Then extract them as they are and remove them from the statement.

    var hashtags = []

    if (morphemes != 1) {
        hashtags = FlowdockText.extractHashtags(statement)

        // Convert them to lowercase
        for (var i = 0; i < hashtags.length; i++) {
            hashtags[i] = hashtags[i].toLowerCase()
        }
    }

    var concepts = []

    // Camelize hashtags in statement in case we want to add both words and hashtags

    statement = statement.replace(/#(\S*)/g, function(match, capture) {
        return S(match).camelize().s
    })

    // All possible value https://github.com/winkjs/wink-tokenizer

    var tokens = myTokenizer.tokenize(statement)

    for (var t = 0; t < tokens.length; t++) {
        if (tokens[t].tag == 'word') {
            // TODO for Chinese and others decrease this number
            if (lng == 'none' || tokens[t].value.toLowerCase().length > 2) {
                concepts.push(tokens[t].value.toLowerCase())
            }
        } else if (tokens[t].tag == 'hashtag') {
            concepts.push(
                S(tokens[t].value.substr(1))
                    .underscore()
                    .s.toLowerCase()
            )
        } else if (tokens[t].tag == 'alien' && lng == 'russian') {
            if (tokens[t].value.toLowerCase().length > 2) {
                concepts.push(tokens[t].value.toLowerCase())
            }
        } else if (tokens[t].tag == 'emoji') {
            concepts.push(tokens[t].value)
        }
    }

    // Make an array of concepts that are not in the stoplist and longer than 1 character OR the ones that belong to hashtags

    var conceptsclean = []

    for (var i = 0; i < concepts.length; i++) {
        if (
            (stopwords.indexOf(concepts[i]) == -1 && concepts[i].length > 0) ||
            hashtags.indexOf(concepts[i]) > -1
        ) {
            conceptsclean.push(concepts[i])
        }
    }

    // Now find lemmas for every concept

    var lemmas = []

    for (var i = 0; i < conceptsclean.length; ++i) {
        // There are hashtags and they should not be lemmatized

        if (morphemes != 1 && hashtags.indexOf(conceptsclean[i]) > -1) {
            // This concept is a hashtag? Then add it to the list of lemmas unchanged

            var hashtag_array = [conceptsclean[i]]

            lemmas.push(hashtag_array)
        }

        // It's not a hashtag
        else {
            if (lng == 'russian') {
                if (lemmerRus && lemmerRus.lemmatize(conceptsclean[i]) != false) {
                    lemmas.push(lemmerRus.lemmatize(conceptsclean[i]))
                } else {
                    var hashtag_array = [conceptsclean[i]]
                    lemmas.push(hashtag_array)
                }
            } else if (lng == 'english') {
                if (lemmerEng && lemmerEng.lemmatize(conceptsclean[i]) != false) {
                    lemmas.push(lemmerEng.lemmatize(conceptsclean[i]))
                } else {
                    var hashtag_array = [conceptsclean[i]]
                    lemmas.push(hashtag_array)
                }
            } else if (lng == 'german') {
                if (lemmerGer && lemmerGer.lemmatize(conceptsclean[i]) != false) {
                    lemmas.push(lemmerGer.lemmatize(conceptsclean[i]))
                } else {
                    var hashtag_array = [conceptsclean[i]]
                    lemmas.push(hashtag_array)
                }
            } else if (lng == 'penglish') {
                var hashtag_array = [
                    natural.PorterStemmer.stem(conceptsclean[i]),
                ]
                lemmas.push(hashtag_array)
            } else if (lng == 'pswedish') {
                var hashtag_array = [
                    natural.PorterStemmerSv.stem(conceptsclean[i]),
                ]
                lemmas.push(hashtag_array)
            } else if (lng == 'pspanish') {
                var hashtag_array = [
                    natural.PorterStemmerEs.stem(conceptsclean[i]),
                ]
                lemmas.push(hashtag_array)
            } else if (lng == 'pportugese') {
                var hashtag_array = [
                    natural.PorterStemmerPt.stem(conceptsclean[i]),
                ]
                lemmas.push(hashtag_array)
            } else if (lng == 'french') {
                // Activate French lemmer on it
                var lemmerFra = new NlpjsTFr(conceptsclean[i])

                // Get intermediary lemmas on it
                var lemmaspre = lemmerFra.lemmatizer()

                // just making sure this lemma exists and it's the first one in the list
                if (lemmaspre[0] && lemmaspre[0]['lemma'] != undefined) {
                    var hashtag_array = [lemmaspre[0]['lemma']]

                    lemmas.push(hashtag_array)
                }
            } else {
                var hashtag_array = [conceptsclean[i]]

                lemmas.push(hashtag_array)
            }
        }
    }

    // There are hashtags or no hashtags and both words and hashtags should be lemmatized

    // Get the first result and make a clean array
    // TODO find a way to better process multiple results, e.g. return the shortest word

    var lemmasclean = []

    for (var i = 0; i < lemmas.length; ++i) {
        if (lemmas[i][0] != undefined) {
            if (
                (stopwords.indexOf(lemmas[i][0]) == -1 &&
                    lemmas[i][0].length > 0) ||
                hashtags.indexOf(lemmas[i][0]) > -1
            ) {
                lemmasclean.push(
                    lemmas[i][0].toLowerCase().replace(/[\\–-]/g, '')
                )
            }
        }
    }

    console.log('Lemmas final obtained:')
    console.log(lemmasclean)

    return lemmasclean
}

// Function to extract context from any input

function extractMentions(statement) {
    var mentions = FlowdockText.extractMentions(statement)

    // Convert them to lowercase
    for (var i = 0; i < mentions.length; i++) {
        mentions[i] = mentions[i].toLowerCase()

        // makes sure the context name is safe
        mentions[i] = mentions[i].replace(/[\.,-\/#!$%\^&\*;:{}=\-_`~()]/g, '_')
    }

    return mentions
}

// EXPORTS FOR VALIDATION PURPOSES

// Checks if the user is logged in

exports.isLoggedIn = function() {
    return function(req, res, next) {
        if (!res.locals.user) {
            res.error('Please, log in or register first.')
            res.redirect('back')
        } else {
            next()
        }
    }
}

// Checks if the statement should be deleted or edited

exports.isToDelete = function() {
    return function(req, res, next) {
        // Are we here to delete, to edit, or are we just passing by?

        console.log('reqbody')
        console.log(req.body)
        if (
            req.body.delete == 'delete' ||
            req.body.edit == 'edit' ||
            req.body.delete == 'delete context'
        ) {
            if (req.body.delete == 'delete context') {
                mdb.getDb(function(err, db) {
                    if (err) return next(err)
                    db.collection('contexts').findOne(
                        { name: req.body.context, by: res.locals.user.uid },
                        { projection: { uid: 1 } },
                        function(err, ctxDoc) {
                            if (err) return next(err)
                            if (!ctxDoc) { res.error('Context not found'); return res.redirect('back') }
                            var context_id = ctxDoc.uid
                            Promise.all([
                                new Promise(function(r, j) { db.collection('relationships').deleteMany({ context: context_id }, function(e) { e ? j(e) : r() }) }),
                                new Promise(function(r, j) { db.collection('statements').deleteMany({ contextIds: context_id }, function(e) { e ? j(e) : r() }) }),
                                new Promise(function(r, j) { db.collection('contexts').deleteOne({ uid: context_id }, function(e) { e ? j(e) : r() }) }),
                            ]).then(function() {
                                deleteContext(goBackContext)
                            }).catch(function(e) { next(e) })
                        }
                    )
                })
            } else {
                if (req.body.delete == 'delete') {
                    if (req.body.statementid) {
                        deleteStatement(goBack)
                    } else {
                        res.error('Sorry, but we did not get the ID of what you wanted to delete.')
                        res.redirect('back')
                    }
                } else if (req.body.edit == 'edit') {
                    if (req.body.statementid) {
                        deleteStatement(moveOn)
                    } else {
                        res.error('Sorry, but we did not get the ID of what you wanted to edit.')
                        res.redirect('back')
                    }
                }
            }
        }

        // Neither delete, nor edit, so we move on to entries.submit (adding a new statement, that is)
        else {
            next()
        }

        function deleteStatement(callback) {
            var statementId = req.body.statementid
            mdb.getDb(function(err, db) {
                if (err) return callback(err)
                Promise.all([
                    new Promise(function(r, j) { db.collection('relationships').deleteMany({ statement: statementId }, function(e) { e ? j(e) : r() }) }),
                    new Promise(function(r, j) { db.collection('statements').deleteOne({ uid: statementId }, function(e) { e ? j(e) : r() }) }),
                ]).then(function() {
                    callback(null, {})
                }).catch(function(e) { callback(e) })
            })
        }

        function deleteContext(callback) {
            callback(null, {})
        }

        // That's in case we want to go back (when deleted, for example)

        function goBack(err, answer) {
            // Error? Display it.
            if (err) {
                console.log(err)
                res.send({
                    errormsg:
                        'Sorry, something went wrong on the Deleting part...',
                })
            } else {
                // If all is good, make a message for the user and send him back
                res.send({
                    successmsg: 'The statement was removed.',
                    statementid: req.body.statementid,
                })
            }
        }

        function goBackContext(err, answer) {
            // Error? Display it.
            if (err) {
                console.log(err)
                res.error('Sorry, something went wrong on the Deleting part...')
                res.redirect('back')
            } else {
                // If all is good, make a message for the user and send him back
                res.error('The whole list was removed.')
                res.redirect('back')
            }
        }

        // That's when we want to move on (when deleted and adding a new one

        function moveOn(err, answer) {
            // Error? Display it.
            if (err) {
                console.log(err)
                res.send({
                    errormsg:
                        'Sorry, something went wrong on the Editing part...',
                })
                //                res.redirect('back');
            } else {
                // If all is good, movemove on
                // res.send({successmsg: 'Edited the statement and added at the top of the list.'});
                next()
            }
        }
    }
}

exports.changeContextPrivacy = function() {
    return function(req, res, next) {
        // Does the user want to change context privacy from private to public?
        // Get the parameters from the button submitted

        var privacyquery = ''

        if (req.body.privacy == 'make public') {
            if (!req.body.context) {
                res.error('You did not specify a graph')
                res.redirect('back')
            } else {
                privacyquery =
                    'MATCH (u:User{uid:"' +
                    res.locals.user.uid +
                    '"}), (ctx:Context{name:"' +
                    req.body.context +
                    '"}), (ctx)-[:BY]->(u) WITH DISTINCT ctx SET ctx.public = "1";'
            }

            mdb.getDb(function(err, db) {
                if (err) return next(err)
                db.collection('contexts').updateOne(
                    { name: req.body.context, by: res.locals.user.uid },
                    { $set: { public: '1' } },
                    function(err) {
                        if (err) return next(err)
                        res.error('The graph is now public.')
                        res.redirect('back')
                    }
                )
            })
        }

        else if (req.body.privacy == 'make private') {
            if (!req.body.context) {
                res.error('You did not specify a graph')
                res.redirect('back')
            }

            mdb.getDb(function(err, db) {
                if (err) return next(err)
                db.collection('contexts').updateOne(
                    { name: req.body.context, by: res.locals.user.uid },
                    { $unset: { public: '' } },
                    function(err) {
                        if (err) return next(err)
                        res.error('This graph is now private.')
                        res.redirect('back')
                    }
                )
            })
        } else {
            res.error(
                'You asked to change the graph privacy setting, but provided no settings.'
            )
            res.redirect('back')
        }
    }
}

// Function to sanitize input and clean it from all the apostrophes. TODO: Think of a better option, maybe like jesc

exports.sanitize = function(statement) {
    var result = statement

    if (result) {
        result = S(result)
            .trim()
            .collapseWhitespace().s
        result = result
            .replace(/[„“]/g, '"')
            .replace(/[«»]/g, '"')
            .replace(/\u0000/g, '0')

        console.log('Text body normalized: ' + result)
    } else {
        console.log('Validation string was empty ' + result)
    }

    return result
}

// Extract hashtags from a statement

exports.getHashtags = function(statement, res) {
    val = statement

    var hashtags = []

    // Hashtags are given priority over words? Get them from the statement

    var hashnodes = 0

    if (!res.locals.user.hashnodes) {
        hashnodes = 0
    } else {
        hashnodes = res.locals.user.hashnodes
    }

    if (hashnodes != 1) {
        hashtags = extractHashtags(val)
    }

    var morphemes = 0

    if (!res.locals.user.morphemes) {
        morphemes = 0
    } else {
        morphemes = res.locals.user.morphemes
    }

    // Customized stopwords_de
    var stopwords_custom = ''
    if (!res.locals.user.stopwords) {
        stopwords_custom = ''
    } else {
        stopwords_custom = res.locals.user.stopwords
    }

    // If there were no hashtags, extract every word from a statement
    // But only if there is no setting that only hashtags should be extracted

    if (hashtags[0] == null && hashnodes != 2) {
        hashtags = extractConcepts(
            val,
            morphemes,
            hashnodes,
            stopwords_custom,
            res
        )
    }

    var maxhash = options.settings.max_hashtags

    if (hashtags[0] != null && hashtags.length < maxhash) {
        console.log('Hashtags extracted: ' + hashtags)
    }

    return hashtags
}

// Extract context from the statement

// TODO this will be turned into extracting a mention for a different type of add

exports.getMentions = function(statement) {
    // Contexts extracted from the statement entry form (@mentions)

    var mentions = extractMentions(statement)

    console.log('extracted mentions:')
    console.log(mentions)

    return mentions
}

exports.getContextForEntry = function(field) {
    field = parseField(field)
    var that = this
    return function(req, res, next) {
        var addToContexts = []

        // This is a list of contexts we received with submission
        var addedContexts = req.body.addedContexts

        // Are they comma separated?
        if (addedContexts.indexOf(',') > 0) {
            // Yes? Split and make an array
            addToContexts = addedContexts.split(',')
        } else if (addedContexts.length > 0) {
            // No? just add the value in the string into the array
            addToContexts.push(addedContexts)
        } else {
            var errormsg =
                'Please, choose at least one context for your statement.'
            //res.error(errormsg);
            res.send({ errormsg: errormsg })
        }

        console.log('contexts submitted')
        console.log(addToContexts)

        if (addToContexts.length > 0) {
            that.getContextID(res.locals.user.uid, addToContexts, function(
                result,
                err
            ) {
                if (err) {
                    res.error(
                        'Something went wrong when adding new lists into Neo4J database. Try changing the list name or open an issue on GitHub.'
                    )
                    res.redirect('back')
                } else {
                    var contexts = result
                    req.contextids = contexts
                    console.log('contexts retrieved from db')
                    console.log(req.contextids)
                    next()
                }
            })
        }
    }
}

// Finding out if the context is private

exports.getContextPrivacy = function() {
    return function(req, res, next) {
        // Do we have context name we want to check for privacy setting?

        if (req.params.context) {
            // Let's find what user we need

            var contextforuser = ''

            if (res.locals.user) {
                contextforuser = res.locals.user.name
            } else {
                contextforuser = req.params.user
            }

            var contextname = req.params.context
            contextname = S(contextname)
                .trim()
                .collapseWhitespace().s
            contextname = contextname
                .replace(/[\\"']/g, '\\$&')
                .replace(/\u0000/g, '\\0')

            mdb.getDb(function(err, db) {
                if (err) { console.log(err); return next() }
                db.collection('users').findOne({ name: contextforuser }, { projection: { uid: 1 } }, function(err, userDoc) {
                    if (err || !userDoc) return next()
                    db.collection('contexts').findOne(
                        { name: contextname, by: userDoc.uid },
                        { projection: { public: 1 } },
                        function(err, ctxDoc) {
                            if (err) console.log(err)
                            res.locals.contextpublic = ctxDoc ? ctxDoc.public : null
                            next()
                        }
                    )
                })
            })
        }

        else {
            next()
        }
    }
}

// Get a list of all the contexts added by a user

exports.getContextsList = function(flag) {
    return function(req, res, next) {
        var contextforuser = ''
        var flag

        if (res.locals.user) {
            contextforuser = res.locals.user.name

            // console.log('Getting a list of contexts for user:');
            // console.log(req.params.user);
            // var request_url = res.req._parsedUrl.pathname;
            // This is when user is logged in (res.locals.user.name) but he should see another context (req.params.user)
            if (
                res.locals.user.name != req.params.user &&
                req.params.user != undefined
            ) {
                contextforuser = req.params.user
                flag = 'public'
            }

            if (
                res.locals.user.name != req.params.user &&
                req.params.user == undefined
            ) {
                flag = ''
            }
        } else {
            // The user is logged in?
            if (req.user) {
                if (req.params.user != undefined) {
                    contextforuser = req.params.user
                    flag = 'public'
                } else {
                    contextforuser = req.user.name
                }
            } else {
                contextforuser = req.params.user
                flag = 'public'
            }
        }
        // in /app view
        // console.log(res.locals.user) is defined
        // console.log(req.user) is defined
        //             console.log(req.params.user) is undefined

        mdb.getDb(function(err, db) {
            if (err) { console.log(err); res.locals.contextslist = []; return next() }
            db.collection('users').findOne({ name: contextforuser }, { projection: { uid: 1 } }, function(err, userDoc) {
                if (err || !userDoc) { res.locals.contextslist = []; return next() }
                var ctxFilter = { by: userDoc.uid }
                if (flag == 'public') ctxFilter.public = '1'
                // Only contexts that have at least one statement
                db.collection('statements').distinct('contextIds', { userId: userDoc.uid }, function(err, usedCtxIds) {
                    if (err) usedCtxIds = []
                    if (usedCtxIds.length > 0) ctxFilter.uid = { $in: usedCtxIds }
                    db.collection('contexts').find(ctxFilter, { projection: { name: 1, uid: 1 } }).toArray(function(err, docs) {
                        if (err) console.log(err)
                        res.locals.contextslist = (docs || []).map(function(c) { return [c.name, c.uid] })
                        next()
                    })
                })
            })
        })
    }
}

exports.getContextID = function(user_id, addToContexts, finalCallback) {
    for (var l = 0; l < addToContexts.length; l++) {
        addToContexts[l] = addToContexts[l].replace(/[^\w]/gi, '')
    }
    var contexts = uniques(addToContexts)
    console.log('contexts uniqualized:', contexts)

    mdb.getDb(function(err, db) {
        if (err) { console.log(err); return finalCallback(null, err) }

        db.collection('contexts').find(
            { by: user_id, name: { $in: contexts } },
            { projection: { uid: 1, name: 1 } }
        ).toArray(function(err, existing) {
            if (err) { console.log(err); return finalCallback(null, err) }

            var newcontexts = existing.map(function(c) { return { uid: c.uid, name: c.name } })
            var existingNames = existing.map(function(c) { return c.name })
            var timestamp = new Date().getTime() * 10000

            var toCreate = []
            contexts.forEach(function(name) {
                if (existingNames.indexOf(name) < 0) {
                    var newCtx = { uid: uuid.v1(), name: name }
                    newcontexts.push(newCtx)
                    toCreate.push({ uid: newCtx.uid, name: name, by: user_id, timestamp: timestamp, public: '0' })
                }
            })

            if (toCreate.length == 0) return finalCallback(newcontexts)

            db.collection('contexts').insertMany(toCreate, { ordered: false }, function(err) {
                if (err) console.log('Context insert error:', err)
                finalCallback(newcontexts)
            })
        })
    })
}

// How to know user's ID from their name
// TODO This function should probably go somewhere else, not so cool to have Cypher query in here also

exports.getUserID = function() {
    return function(req, res, next) {
        if (req.params.user) {
            var userid = S(req.params.user).trim().collapseWhitespace().s
            mdb.getDb(function(err, db) {
                if (err) { console.log(err); return res.redirect('/') }
                db.collection('users').findOne({ name: userid }, function(err, doc) {
                    if (err) { console.log(err); return res.redirect('/') }
                    if (!doc) return res.redirect('/' + req.params.user + '/error/404')
                    res.locals.viewuser = doc.uid
                    res.locals.vieweduser = {}
                    if (doc.stopwords) res.locals.vieweduser.stopwords = doc.stopwords
                    if (doc.topnodes) res.locals.vieweduser.topnodes = doc.topnodes
                    if (doc.palette) res.locals.vieweduser.palette = doc.palette
                    if (doc.background) res.locals.vieweduser.background = doc.background
                    if (doc.label_threshold) res.locals.vieweduser.label_threshold = doc.label_threshold
                    if (doc.maxnodes) res.locals.vieweduser.maxnodes = doc.maxnodes
                    next()
                })
            })
        } else {
            if (!res.locals.user) {
                res.locals.viewuser = ''
            } else {
                res.locals.viewuser = res.locals.user.uid
            }
            next()
        }
    }
}

exports.getDefaultUser = function() {
    return function(req, res, next) {
        req.params.user = options.default_user
        mdb.getDb(function(err, db) {
            if (err) { console.log(err); return res.redirect('/login') }
            db.collection('users').findOne({ name: options.default_user }, { projection: { uid: 1 } }, function(err, doc) {
                if (err || !doc) return res.redirect('/login')
                res.locals.viewuser = doc.uid
                next()
            })
        })
    }
}

exports.safe_tags = function(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

// This function splits statement into shorter ones without breaking the words

exports.splitStatement = function(str, l) {
    var min_length = options.settings.min_text_length

    var strs = []

    var sep_strs = []

    sep_strs = str.split('\r\n')

    if (sep_strs.length <= 1) {
        sep_strs = str.split('\n')

        if (sep_strs.length <= 1) {
            sep_strs = str.split('\r')
            if (sep_strs.length == 0) {
                sep_strs.push(str)
            }
        }
    }

    sep_strs = sep_strs.filter(value => Object.keys(value).length > 0)

    for (var i = 0; i < sep_strs.length; i++) {
        var newstring = sep_strs[i]
        while (newstring.length > l) {
            var pos = newstring.substring(0, l).lastIndexOf(' ')
            pos = pos <= 0 ? l : pos
            strs.push(newstring.substring(0, pos))
            var ind = newstring.indexOf(' ', pos) + 1
            if (ind < pos || ind > pos + l) ind = pos
            newstring = newstring.substring(ind)
        }
        strs.push(newstring)
    }

    return strs
}
