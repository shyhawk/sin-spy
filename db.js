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

			if (!collectionForType)
				collectionForType = collectionTypes[type] = db.collection(type);

			return collectionForType;
		}

		var colTypePlayer = publicDb.colTypePlayer = function() { return "player"; };
		getCollection(colTypePlayer());
		
		var colTypeCharacter = publicDb.colTypeCharacter = function() { return "character"; };
		getCollection("character");
		
		var colTypeUser = publicDb.colTypeUser = function() { return "user"; };
		getCollection("user");

		// Queues and Queue Functions
		var documentQueueSet = {}; // allows queueing up objects for more efficient batch database operations

		publicDb.queuePlayer = function(id, name) {
			var playerData = {
	            id: id,
	            name: name,
	            characters: [],
	            logs: []
	        };
			return queueObject(colTypePlayer(), playerData);
		};

		publicDb.queueCharacter = function(id, player) {
			var characterData = {
	            id: id,
	            player: player,
	            logs: []
	        };
			return queueObject(colTypeCharacter(), characterData);
		};

		function queueObject(type, data) {
			var queueSet = documentQueueSet[type];
			if (!queueSet) 
				queueSet = documentQueueSet[type] = {};

			queueSet[data.id] = data;
			return data;
		}

		publicDb.findOrAddQueued = function(colType, findCallback, addCallback, completeCallback) {
			findQueued(colType, findCallback, function() {
				console.log("Finding done! Time to add...");
				addQueued(colType, addCallback, completeCallback);
			});
		};

		function findQueued(colType, findCallback, completeCallback) {
			var queueSet = documentQueueSet[colType];
			var idList = Object.keys(queueSet);

			if (idList.length === 0) {
				completeCallback();
				return;
			}

			var collection = getCollection(colType);
			var cursor = collection.find({"id": {$in: idList}});

			cursor.count(function (err, count) {
				if (err) {
					throw(err);
				}

				if (count === 0) {
					completeCallback();
					return;
				}

				var counted = 0;
				cursor.forEach(function(doc, index) {
					counted++;
					delete queueSet[doc.id];
					findCallback(doc);

					if (counted === count){
						completeCallback(); // only fire on final item
					}
				});
			});
		}

		function addQueued(colType, addCallback, completeCallback) {
			var queueSet = documentQueueSet[colType];
			var queued = Object.keys(queueSet).map(function(id, index) {
				return queueSet[id];
			});

			if (queued.length === 0) {
				completeCallback(); // if nothing to insert, just call complete and be done
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
					addCallback(doc);

					if (counted === queued.length) {
						completeCallback(); // only fire on final item
					}
				});
			});
		}
	}
}