var request = require("request");

module.exports = function(playerData, characterData, onlinePlayerData, onlineCharacterData) {
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
		Object.keys(onlinePlayerData).forEach(function(playerId, index){
			var pData = playerData[playerId];
			playerLeft(pData);
		});

		// Mark all online characters as logged off
		Object.keys(onlineCharacterData).forEach(function(characterId, index){
			var cData = characterData[characterId];
			characterLeft(cData, true);
		});
	}
	//publicMonitor.cleanLogs = cleanLogs;

	publicMonitor.update = function updateOnlineData() {
	    request("http://nwn.sinfar.net/getonlineplayers.php", function(error, response, body) {
	        if (!error && response && response.statusCode == 200) {
	            try {
	                var parsedJson = JSON.parse(body);
	                updateData(parsedJson);
	            } catch (e) {
	                console.error(e.stack);
	                throw "Error while updating online data. Application terminated."
	            }
	        } else {
	            console.error("Error %s %s when acquiring player list", response ? response.statusCode : "", error ? ("\"" + error + "\"") : "");
	        }
	    });
	}

	function updateData(parsedData) {
		var updated = false;
		function dataUpdated(){
			if (!updated) { // if a data update occurs, log a separator line before any other logged output
				console.log("=================================================");
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
		            	clients: []
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

	            if (!onlinePlayerData[playerEntry.id]) { // player just logged in
	                playerJoined(pData);
	                if (!characterEntry) { // logged in without a character (webclient login)
	                	dataUpdated();
	                    console.log("%s logged into %s", entry.playerName, getClientName(entry.chatClient));
	                }
	            }

	            if (characterEntry && !onlineCharacterData[characterEntry.id]) { // character just logged in
	                characterJoined(cData);
	                // update player name, portrait, and description in case they have changed
	                updateCharacterData(cData, characterEntry.name, characterEntry.portrait, true);

	                dataUpdated();
	                console.log("%s logged into %s as %s", entry.playerName, getClientName(entry.chatClient), entry.pcName);
	            }
	        });

	        // get list of characters that are no longer online
	        var leftCharacters = Object.keys(onlineCharacterData).filter(function(id) {
	            return !newOnlineCharacterData[id];
	        });

	        // log out charcaters that have left
	        leftCharacters.forEach(function(characterId, index) {
	        	var cData = characterData[characterId];
	        	if (cData) {
	        		characterLeft(cData);
	                var characterEntry = onlineCharacterData[characterId];
	                // update player name, portrait, and description in case they have changed
	                updateCharacterData(cData, characterEntry.name, characterEntry.portrait, true);

	        		dataUpdated();
	        		console.log("%s logged out of %s as %s", characterEntry.player.name, characterEntry.client.name, characterEntry.name);
	        	}
	        });

	        // get list of players that are no longer online
	        var leftPlayers = Object.keys(onlinePlayerData).filter(function(id) {
	        	return !newOnlinePlayerData[id];
	        });

	        // log out players that have left
	        leftPlayers.forEach(function(playerId, index) {
	            var pData = playerData[playerId];
	            if (pData) {
	                playerLeft(pData);

	                var playerEntry = onlinePlayerData[playerId];
	                // only print player logout if there's just one player entry, and it's not for a character (webclient)
	                if (playerEntry.clients.length == 1 && !playerEntry.clients[0].character) {
	                    dataUpdated();
	                    console.log("%s logged out of %s", playerEntry.name, playerEntry.clients[0].name);
	                }
	            }
	        });

	        onlinePlayerData = newOnlinePlayerData;
	        onlineCharacterData = newOnlineCharacterData;
	    }
	}

	function getOrAddPlayer(playerData, entry) {
	    var pData = playerData[entry.playerId];
	    if (!pData) { // player has no record, so create one
	        pData = playerData[entry.playerId] = {
	            id: entry.playerId,
	            name: entry.playerName,
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
		// if last log was <= 10 mins ago, strike last quit value and consider the log continued
		if (latestLog && now - latestLog.quit <= 600000) {
			latestLog.quit = undefined;
			latestLog.continued = true;
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
	    if (latestLog.continued) { // used to tell whether existing logs were modified or if this log is new
	    	latestLog.continued = undefined;
	    }
	}

	function updateCharacterData(cData, name, portrait, updateDescription) {
	    // only update character name and portrait if valid new values exist
	    if (name) cData.name = name;
	    if (portrait) cData.portrait = portrait;

	    if (updateDescription) {
	        getCharacterDescription(cData.id, function(desc) {
	            cData.description = desc;
	        }); // get description
	    }
	}

	function getClientName(client) {
	    return clients[client] || (client === null ? "Offline" : "Other");
	}

	function getCharacterDescription(characterId, callback) {
	    request("http://nwn.sinfar.net/getcharbio.php?pc_id=" + characterId, function(error, response, body) {
	        if (!error && response && response.statusCode == 200) {
	            callback(/^ERROR[0-9]*$/.test(body) ? "" : body); // ignore error codes
	        } else {
	            console.error("Error %s: \"%s\" when acquiring character %s description", response.statusCode, error, characterId);
	        }
	    });
	}

	return publicMonitor;
}