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

		var colTypePlayer = publicDb.colTypePlayer = function () { return "player"; };
		getCollection(colTypePlayer());

		
		var colTypeCharacter = publicDb.colTypeCharacter = function () { return "character"; };
		getCollection("character");

		
		var colTypeUser = publicDb.colTypeUser = function() { return "user"; };
		getCollection("user");
	}
}