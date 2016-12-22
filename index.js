var request = require("request");
var fs = require("fs");
var express = require("express");
var app = express();

var clients = { // locations by chatClient
    "web": "Webclient",
    "5121": "Sinfar",
    "5122": "The Dreaded Lands",
    "5123": "Sinfar's Outer Isles",
    "5124": "Arche Terre"
};

// currently online players and characters
var onlinePlayerData = {};
var onlineCharacterData = {};

var playerDataFile = process.env.PDATA_FILE;
var characterDataFile = process.env.CDATA_FILE;

// attempt to restore persistent player and character data
var playerData = restoreData(playerDataFile);
var characterData = restoreData(characterDataFile);

// initial call
updateOnlineData();
// check for updates every interval
var runInterval = setInterval(function() {
    updateOnlineData();
}, process.env.POLL_FREQ);

// prevent Heroku app from sleeping by having it wake itself up
var wakeInterval;
if (process.env.APP_URL) {
    wakeInterval = setInterval(function() {
        request(process.env.APP_URL);
    }, 1500000); // every 25 minutes
}

// On exit
process.on("exit", function(code) {
    if (playerDataFile && characterDataFile) {
    	// Make copies of data (to avoid modifying originals)
    	var playerDataCopy = JSON.parse(JSON.stringify(playerData));
    	var characterDataCopy = JSON.parse(JSON.stringify(characterData));

    	cleanLogs(playerDataCopy, characterDataCopy);

    	saveData(playerDataFile, playerDataCopy);
    	saveData(characterDataFile, characterDataCopy);
    } else {
        console.log("Data not saved.");
    }
});

// Ctrl+C exit
process.on("SIGINT", function() {
	process.exit(0);
});

// Heroku termination
process.on("SIGTERM", function() {
    process.exit(0);
});

// Error exit
process.on("uncaughtException", function(err){
	console.dir (err, { depth: null });
	process.exit (1);
});

// get dump of player data
app.get("/pdata/", function(req, res) {
    res.send(escapeHtml(JSON.stringify(playerData)));
});

// get dump of character data
app.get("/cdata/", function(req, res) {
    res.send(escapeHtml(JSON.stringify(characterData)));
});

// get dump of online player data
app.get("/players/", function(req, res) {
    res.send(escapeHtml(JSON.stringify(onlinePlayerData)));
});

// get dump of online character data
app.get("/characters/", function(req, res) {
    res.send(escapeHtml(JSON.stringify(onlineCharacterData)));
});

// start app
var listener = app.listen(process.env.PORT || 3000);

console.log("##### App is running on port %d. Server will be polled every %d seconds. #####", listener.address().port, process.env.POLL_FREQ / 1000);

//// Player Data File Handling ////

function cleanLogs(playerData, characterData) {
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

function saveData(dataFile, jsonData) {
	try {
		// Write JSON to file (sync to prevent app from exiting before write is complete)
		fs.writeFileSync(dataFile, JSON.stringify(jsonData));
		console.log("Data successfully saved to %s", dataFile);
	} catch (e) {
		console.error("Failed to write data to file %s", dataFile);
		throw(e);
	}
}

function restoreData(dataFile) {
	if (dataFile && fs.existsSync(dataFile)) {
		try {
			// Read JSON player data (sync to ensure it is fully parsed before app continues)
			var restoredData = JSON.parse(fs.readFileSync(dataFile).toString());
			console.log("Data successfully restored from %s", dataFile);
			return restoredData;
		} catch (e) {
			console.error("Error in data file %s. Data not restored.", dataFile);
			throw(e);
		}
	} else {
		console.log("Data file \"%s\" doesn't exist. Data not restored.", dataFile);
		return {};
	}
}

//// Player Data Handling ////

function updateOnlineData() {
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
    var newLog = {
        joined: Date.now()
    };
    pData.logs.push(newLog);
}

function characterJoined(cData) {
    var newLog = {
        joined: Date.now()
    };
    cData.logs.push(newLog);
}

function characterLeft(cData) {
    // get latest log, modify it, and put it back
    var latestLog = cData.logs.pop();
    latestLog.quit = Date.now();
    cData.logs.push(latestLog);
}

function playerLeft(pData) {
    // get latest log, modify it, and put it back
    var latestLog = pData.logs.pop();
    latestLog.quit = Date.now();
    pData.logs.push(latestLog);
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

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}