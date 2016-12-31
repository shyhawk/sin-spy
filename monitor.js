var request = require("request");

module.exports = function(db, playerData, characterData, onlinePlayerDataProperty, onlineCharacterDataProperty, logging) {
	var publicMonitor = {};

	var clients = { // locations by chatClient
	    "web": "Webclient",
	    "5121": "Sinfar",
	    "5122": "The Dreaded Lands",
	    "5123": "Sinfar's Outer Isles",
	    "5124": "Arche Terre"
	};

	//// Player Data Handling ////

	publicMonitor.cleanup = function cleanLogs(playerData, characterData) {
		// Mark all online players as logged off
		Object.keys(onlinePlayerDataProperty()).forEach(function(playerId, index){
			var pData = playerData[playerId];
			playerLeft(pData);
		});

		// Mark all online characters as logged off
		Object.keys(onlineCharacterDataProperty()).forEach(function(characterId, index){
			var cData = characterData[characterId];
			characterLeft(cData, true);
		});
	}

	publicMonitor.update = function updateOnlineData() {
	    request("http://nwn.sinfar.net/getonlineplayers.php", function(error, response, body) {
	        if (!error && response && response.statusCode == 200) {
	            try {
	                var parsedJson = JSON.parse(body);
	                updateData(parsedJson);
	            } catch (e) {
	                logging.error(e.stack);
	                throw "Error while updating online data. Application terminated."
	            }
	        } else {
	            logging.error("Error %s %s when acquiring player list", response ? response.statusCode : "", error ? ("\"" + error + "\"") : "");
	        }
	    });
	}

	function updateData(parsedData) {
		var updated = false;
		function dataUpdated(){
			if (!updated) { // if a data update occurs, log a separator line before any other logged output
				logging.log("========================= %s ========================", (new Date()).toUTCString());
				updated = true;
			}
		}

	    if (parsedData) {
	        var newOnlinePlayerData = {};
	        var newOnlineCharacterData = {};

	        parsedData.forEach(function(entry, index) {
	        	var playerEntry = newOnlinePlayerData[entry.playerId];
	        	if (!playerEntry) {
		            playerEntry = newOnlinePlayerData[entry.playerId] = {
		            	name: entry.playerName, 
		            	id: entry.playerId,
		            	clients: [],
		            	latestClient: function() {return this.clients[this.clients.length - 1];}
		            };
		        }

		        // add to current list of active player clients
	            playerEntry.clients.push({
	            	id: entry.chatClient,
	            	name: getClientName(entry.chatClient),
	                character: !entry.pcId ? null : {
	                    id: entry.pcId,
	                    name: entry.pcName
	                }
	            });

	            var pData = getOrAddPlayer(playerData, entry);

	            var characterEntry = newOnlineCharacterData[entry.pcId];
	            if (entry.pcId && !characterEntry) {
	            	characterEntry = newOnlineCharacterData[entry.pcId] = {
	            		name: entry.pcName, 
	            		id: entry.pcId, 
	                    portrait: entry.portrait,
	                    client: {
	                        id: entry.chatClient,
	                        name: getClientName(entry.chatClient)
	                    },
	            		player: {
	            			id: playerEntry.id,
	            			name: playerEntry.name
	            		}
	            	};
	            }

	            var cData = getOrAddCharacter(characterData, pData, entry);

	            if (!onlinePlayerDataProperty()[playerEntry.id]) { // player just logged in
	                playerJoined(pData);

	                db.queuePlayer(pData.id, pData.name, pData.portrait);

	                if (!characterEntry) { // logged in without a character (webclient login)
	                	dataUpdated();
	                    logging.log("%s logged into %s", playerEntry.name, playerEntry.latestClient().name);
	                }
	            }

	            if (characterEntry) {
	            	var previousCharacterEntry = onlineCharacterDataProperty()[characterEntry.id];
	            	if (!previousCharacterEntry) { // character just logged in
		                characterJoined(cData);

		                db.queueCharacter(cData.id, pData.id, cData.name, cData.portrait);

		                dataUpdated();
		                logging.log("%s logged into %s as %s", characterEntry.player.name, characterEntry.client.name, characterEntry.name);
		            } else if (characterEntry.client.id !== previousCharacterEntry.client.id) {
		            	dataUpdated(); // character client (server) change
		            	logging.log("%s as %s switched from %s to %s", characterEntry.player.name, characterEntry.name, previousCharacterEntry.client.name, characterEntry.client.name);
		            }
	            }
	            
	        });

	        // get list of characters that are no longer online
	        var leftCharacters = Object.keys(onlineCharacterDataProperty()).filter(function(id) {
	            return !newOnlineCharacterData[id];
	        });

	        // log out charcaters that have left
	        leftCharacters.forEach(function(characterId, index) {
	        	var cData = characterData[characterId];
	        	if (cData) {
	        		characterLeft(cData);
	                var characterEntry = onlineCharacterDataProperty()[characterId];
	                var playerEntry = newOnlinePlayerData[characterEntry.player.id];

	        		dataUpdated();
	        		if (playerEntry) { // character logged off but player is still online
	        			logging.log("%s logged off from %s as %s", characterEntry.player.name, characterEntry.client.name, characterEntry.name);
	        		} else { // character logged off and player is offline too
	        			logging.log("%s logged off from %s as %s and quit", characterEntry.player.name, characterEntry.client.name, characterEntry.name);
	        		}
	        	}
	        });

	        // get list of players that are no longer online
	        var leftPlayers = Object.keys(onlinePlayerDataProperty()).filter(function(id) {
	        	return !newOnlinePlayerData[id];
	        });

	        // log out players that have left
	        leftPlayers.forEach(function(playerId, index) {
	            var pData = playerData[playerId];
	            if (pData) {
	                playerLeft(pData);

	                var playerEntry = onlinePlayerDataProperty()[playerId];
	                // only print player logout if there's just one player entry, and it's not for a character (webclient)
	                if (playerEntry.clients.length == 1 && !playerEntry.latestClient().character) {
	                    dataUpdated();
	                    logging.log("%s quit %s", playerEntry.name, playerEntry.latestClient().name);
	                }
	            }
	        });

	        onlinePlayerDataProperty(newOnlinePlayerData);
	        onlineCharacterDataProperty(newOnlineCharacterData);

	        if (db.queuedCount(db.colTypePlayer())) {
		        db.findOrAddQueued(db.colTypePlayer()
	        	,retrievedData(playerData, playerFound)
	        	,retrievedData(playerData, playerAdded)
	        	,function() {
		            logging.log("Player db retrieval completed");
		        });
		    }

		    if (db.queuedCount(db.colTypeCharacter())) {
	            db.findOrAddQueued(db.colTypeCharacter()
	        	,retrievedData(characterData, characterFound)
	        	,retrievedData(characterData, characterAdded)
	        	,function() {
	            	logging.log("Character db retrieval completed");
	            });
	        }
	    }
	}

	function retrievedData(localData, callback) {
		return function(dbData) {
			var thisData = localData[dbData.id];
			if (callback) callback(dbData, thisData);
			mergeLogs(thisData.logs, dbData.lastLog);
		}
	}

	function playerFound(dbData, pData) {
		 // check of portrait was updated
		updatePlayerData(pData, dbData.portrait, true);
		updatePlayerDb(pData);

		logging.log("Retrieved player %s", dbData.name);
	}

	function playerAdded(dbData, pData) {
		// when first adding a player, consider it clean, since all updatable data was already set on creation
		delete pData.dirty;
		logging.log("Added player %s", dbData.name);
	}

	function characterFound(dbData, cData) {
		cData.description = dbData.description; // must manually set description

        // update character name, portrait, and description in case they have changed
        updateCharacterData(cData, dbData.name, dbData.portrait, true, function(cData) {
        	updateCharacterDb(cData);
        });

		logging.log("Retrieved character %s", dbData.name);
	}

	function characterAdded(dbData, cData) {
		cData.description = dbData.description; // must manually set description

		// get character description
		updateCharacterData(cData, dbData.name, dbData.portrait, true, function(cData) {
        	updateCharacterDb(cData);
        });

		logging.log("Added character %s", dbData.name);
	}

	function getOrAddPlayer(playerData, entry) {
	    var pData = playerData[entry.playerId];
	    if (!pData) { // player has no record, so create one
	        pData = playerData[entry.playerId] = {
	            id: entry.playerId,
	            name: entry.playerName,
	            portrait: entry.pcId ? undefined : entry.portrait,
	            characters: [],
	            logs: []
	        };
	    }

	    return pData;
	}

	function getOrAddCharacter(characterData, pData, entry) {
	    if (!entry.pcId) return null; // ignore for entries without character data

	    var cData = characterData[entry.pcId];
	    if (!cData) { // character has no record, so create one
	        cData = characterData[entry.pcId] = {
	            id: entry.pcId,
	            player: entry.playerId,
	            name: entry.pcName,
	            portrait: entry.portrait,
	            logs: []
	        }

	        // add character to player's character list
	        pData.characters.push(entry.pcId);
	    }

	    return cData;
	}

	function playerJoined(pData) {
		joined(pData.logs);
	}

	function characterJoined(cData) {
	    joined(cData.logs);
	}

	function characterLeft(cData) {
	    left(cData.logs);
	}

	function playerLeft(pData) {
	    left(pData.logs);
	}

	function joined(logs) {
		var latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
		var now = Date.now();
		// if last log was <= min log time ago, strike last quit value and consider the log continued
		if (latestLog && now - latestLog.quit <= minLogTime()) {
			delete latestLog.quit;
			latestLog.continued = true;
			delete latestLog.dirty; // continued, ongoing logs are not ready to be sent to db, and so are not considered "dirty"
		} else { // otherwise create a new log
		    var newLog = {
		        joined: Date.now()
		    };
		    logs.push(newLog);
		}
	}

	function left(logs) {
		// get latest log and add quit time
	    var latestLog = logs[logs.length - 1];
	    latestLog.quit = Date.now();
	    latestLog.dirty = true; // needs to be synced with database
	    if (latestLog.continued) { // used to tell whether existing logs were modified or if this log is new
	    	latestLog.continued = undefined;
	    }
	}

	function mergeLogs(logs, latestLog) {
		if (logs.length === 0)
			return false; // no logs queued, so nothing to update

		if (!latestLog)
			return true; // there is no existing latest log, so no merging is necessary, but an update is

		if (logs[0].joined - latestLog.quit <= minLogTime()) {
			logs[0].joined = latestLog.joined;
			logs[0].override = true;
		}

		return true; // merge occurred, and an update is necessary
	}

	function minLogTime() {
		return 600000; // equivalent of 10 minutes
	}

	function updatePlayerData(pData, portrait, pDataHasNewest) {
		// if the new portrait isn't falsey and the old and new portraits don't match, replace
		if ((pDataHasNewest ? pData.portrait : portrait) && pData.portrait != portrait) {
			if (!pDataHasNewest) pData.portrait = portrait;
			pData.dirty = pData.dirty || true; // portrait was updated
			return true;
		}
		return false;
	}

	function updateCharacterData(cData, name, portrait, cDataHasNewest, callback) {
		var updated = false;
	    // only update character name and portrait if valid new values exist
	    if ((cDataHasNewest ? cData.name : name) && name != cData.name) {
	    	updated = true;
	    	if (!cDataHasNewest) cData.name = name;
	    }
	    if ((cDataHasNewest ? cData.portrait : portrait) && portrait != cData.portrait) {
	    	updated = true;
	    	if (!cDataHasNewest) cData.portrait = portrait;
	    }
        getCharacterDescription(cData.id, function(desc) {
        	if (desc != cData.description) {
        		updated = true;
        		cData.description = desc;
        	}

        	cData.dirty = cData.dirty || updated; // name, portrait, or description were updated
        	if (callback) callback(cData);
        }); // get description
	}

	function getClientName(client) {
	    return clients[client] || (client === null ? "Offline" : "Other");
	}

	var activeDescRequests = 0;
	function getCharacterDescription(characterId, callback) {
		activeDescRequests++;
	    request("http://nwn.sinfar.net/getcharbio.php?pc_id=" + characterId, function(error, response, body) {
	        if (!error && response && response.statusCode == 200) {
	            callback(/^ERROR[0-9]*$/.test(body) ? "" : body); // ignore error codes
	        } else {
	            logging.error("Error %s: \"%s\" when acquiring character %s description", response ? response.statusCode : "", error, characterId);
	        }

	        logging.log("Description request completed. %d remaining.", --activeDescRequests);
	    });
	}

	function updatePlayerDb(pData) {
		if (pData.dirty) {
			db.updatePlayer(pData.id, pData.portrait);
			delete pData.dirty;
			logging.log("Player %s updated.", pData.name);
		}
	}

	function updateCharacterDb(cData) {
		if (cData.dirty) {
			db.updateCharacter(cData.id, cData.name, cData.portrait, cData.description);
			delete cData.dirty;
			logging.log("Character %s updated", cData.name);
		}
	}

	return publicMonitor;
}