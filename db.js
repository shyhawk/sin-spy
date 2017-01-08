var mongodb = require("mongodb");

module.exports = function(dbString, logging, callback) {
	if (!dbString) {
		throw "No Database connection string provided";
	}

	var publicDb = {};

	var mongoClient = mongodb.MongoClient;
	mongoClient.connect(dbString, function(err, db) {
		if (err) {
			logging.error("Could not connect to database.");
			throw err;
		} else {
			logging.log("Connected to database.");
			dbConnected(db);
			callback(publicDb);
		}
	});

	function dbConnected(db) {
		// Collections and Collection Types
		var collectionTypes = {}; // retains loaded collections
		function getCollection(type) {
			var collectionForType = collectionTypes[type];

			if (!collectionForType) {
				collectionForType = collectionTypes[type] = db.collection(type);
			}

			return collectionForType;
		}

		function colTypePlayer() { return "player"; };
		publicDb.colTypePlayer = colTypePlayer;
		getCollection(colTypePlayer());
		
		function colTypeCharacter() { return "character"; };
		publicDb.colTypeCharacter = colTypeCharacter;
		getCollection("character");
		
		//function colTypeUser() { return "user"; };
		//publicDb.colTypeUser = colTypeUser;
		//getCollection("user");

		//// Queues and Queue Functions ////

		var documentQueueSet = {}; // allows queueing up objects for more efficient batch database operations

		publicDb.queuePlayer = function(id, name, portrait) {
			var playerData = {
				_id: id,
	            id: id,
	            name: name,
	            portrait: portrait,
	            characters: [],
	            logs: []
	        };
			queueObject(colTypePlayer(), playerData);
		};

		publicDb.queueCharacter = function(id, name, portrait) {
			var characterData = {
				_id: id,
	            id: id,
	            name: name,
	            portrait: portrait,
	            players: [],
	            logs: []
	        };
			queueObject(colTypeCharacter(), characterData);
		};

		function queueObject(type, data) {
			var queueSet = documentQueueSet[type];
			if (!queueSet) 
				queueSet = documentQueueSet[type] = {};

			var existing = queueSet[data.id];
			if (!existing) {
				queueSet[data.id] = data;
				return data;
			} else {
				return existing;
			}
		}

		publicDb.findOrAddQueued = function(colType, findCallback, addCallback, completeCallback) {
			findQueued(colType, findCallback, function() {
				addQueued(colType, addCallback, completeCallback);
			});
		};

		publicDb.queuedCount = function(colType) {
			var queueSet = documentQueueSet[colType];
			return queueSet ? Object.keys(queueSet).length : 0;
		}

		function findQueued(colType, findCallback, completeCallback) {
			var queueSet = documentQueueSet[colType];
			var idList = Object.keys(queueSet);

			if (idList.length === 0) {
				completeCallback();
				return;
			}

			findForType(colType, idList, function(err, doc) {
				if (err) {
					throw(err);
				}

				if (doc) {
					delete queueSet[doc.id];
					if (findCallback) findCallback(doc);
				} else { // doc is null when complete
					if (completeCallback) completeCallback(idList.length); // only fire on final item
				}
			});
		}

		function findForType(colType, idList, eachDocCallback) {
			// build functions
			var collection = getCollection(colType);

			if (colType === colTypeCharacter()) {
				collection.aggregate([
					{$match: {id: {$in: idList}}},
					{$lookup: {from: colTypePlayer(), localField: "id", foreignField: "characters", as: "playersSet"}},
					{$project: {
						id: 1,
						name: 1,
						portrait: 1,
						description: 1,
						players: "$playersSet.id"
					}}
				]).each(eachDocCallback);
			} else if (colType === colTypePlayer()) {
				collection.find({id: {$in: idList}}, { _id: 0, logs: 0 }).each(eachDocCallback); // don't include mongodb ID or the full array of logs
			}
		}

		function addQueued(colType, addCallback, completeCallback) {
			var queueSet = documentQueueSet[colType];
			var queued = Object.keys(queueSet).map(function(id, index) {
				return queueSet[id];
			});

			if (queued.length === 0) {
				completeCallback(queued.length); // if nothing to insert, just call complete and be done
				return;
			}

			var collection = getCollection(colType);
			collection.insert(queued, {w:1}, function(err, result) {
				if (err) {
					throw(err);
				}

				var counted = 0;
				queued.forEach(function(doc, index) {
					counted++
					delete queueSet[doc.id]; // clear from set
					if (addCallback) addCallback(doc);

					if (counted === queued.length) {
						if (completeCallback) completeCallback(queued.length); // only fire on final item
					}
				});
			});
		}

		//// Data Updates ////

		publicDb.addCharactersToPlayer = function(id, characters) {
			var isArray = Array.isArray(characters); // accept array or single value
			if (!id || !characters || (isArray && characters.length === 0))
				return;

			var players = getCollection(colTypePlayer());
			if (isArray) {
				players.update({id: id}, {$addToSet: {characters: {$each: characters}}});
			} else {
				players.update({id: id}, {$addToSet: {characters: characters}});
			}
		};

		publicDb.updatePlayerInfo = function(id, portrait) {
			var players = getCollection(colTypePlayer());
			players.update({id: id}, {$set: {portrait: portrait}});
		};

		publicDb.updateCharacterInfo = function(id, name, portrait, description) {
			var characters = getCollection(colTypeCharacter());
			characters.update({id: id}, {$set: {name: name, portrait: portrait, description: description}});
		};

		publicDb.updateLogs = function(type, id, logs, callback) {
			var collection = getCollection(type);
			var logList = [];
			var replaceLatest = false;

			// make clean copied of log entries
			logs.forEach(function(log, index) {
				if (log.quit && !log.synced) {
					var copiedLog = {joined: log.joined, quit: log.quit};
					if (log.override)
						replaceLatest = true;

					logList.push(copiedLog);
				}
			});

			var completedUpdates = 0;
			var updateComplete = function() {
				completedUpdates++;
				if (completedUpdates === logList.length && callback)
					callback();
			};

			if (logList.length > 0) {
				if (replaceLatest) {
					popLatestLog(function() {
						pushLogs(logList, updateComplete);
					});
				} else {
					pushLogs(logList, updateComplete);
				}
			}

			function popLatestLog(callback) {
				collection.update(
					{id: id}, {$pop: {logs: 1}}, callback);
			}

			function pushLogs(logs, callback) {
				collection.update({id: id}, {$push: {logs: {$each: logList}}, $set: {latestLog: logs[logs.length - 1]}}, callback);
			}
		};
	}
}