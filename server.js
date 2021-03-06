var request = require("request");
var express = require("express");

module.exports = function() {
    var publicServer = {};

    var app = express();

    var startTime = Date.now();

    var logging = (function () {
        var debugLevel = getEnvVar(process.env.DEBUG) || 0;

        return {
            error: function() {
                var args = Array.prototype.slice.call(arguments);
                if (args.length > 0 && typeof args[0] === "string") {
                    console.error.apply(console, args);
                } else {
                    console.dir.apply(console, args);
                }
            },
            warn: function() {
                if (debugLevel > 0) {
                    var args = Array.prototype.slice.call(arguments);
                    console.warn.apply(console, args);
                }
            },
            log: function() {
                if (debugLevel > 1) {
                    var args = Array.prototype.slice.call(arguments);
                    console.log.apply(console, args);
                }
            }
        };
    }());

    require("./db.js")(getEnvVar(process.env.DB_STRING), logging, dbConnected);

    publicServer.shutdown = function(callback) {
        console.log("#### Server was shut down before being fully initialized ####");
    };

    function dbConnected(db) { // database connection successful! Now run server
        // currently online players and characters
        var onlinePlayerData = {};
        var onlineCharacterData = {};

        var playerDataFile = getEnvVar(process.env.PDATA_FILE);
        var characterDataFile = getEnvVar(process.env.CDATA_FILE);

        // attempt to restore persistent player and character data
        var playerData = restoreData(playerDataFile);
        var characterData = restoreData(characterDataFile);

        var monitor = require("./monitor.js")(db, playerData, characterData, 
            function(newData){ // encapsulates online player data scope to provide artificial pass-by-reference
            if (newData) onlinePlayerData = newData;
            return onlinePlayerData;
        }, function(newData) { // encapsulates online character data scope to provide artificial pass-by-reference
            if (newData) onlineCharacterData = newData;
            return onlineCharacterData;
        }, logging);

        // initial call
        var pollFreq = getEnvVar(process.env.POLL_FREQ) || 15000; // default to every 15 seconds
        var runInterval;
        monitor.update(function() { // check for updates every interval
            runInterval = setInterval(function() {
                monitor.update();
            }, pollFreq);
        });

        // prevent Heroku app from sleeping by having it wake itself up
        var wakeInterval;
        var appUrl = getEnvVar(process.env.APP_URL);
        if (appUrl) {
            wakeInterval = setInterval(function() {
                request(appUrl);
            }, 1500000); // every 25 minutes
        }

        // set up function call for graceful server shutdown
        publicServer.shutdown = function shutdown(callback) {
            console.log("\n#### Shutting down server... ####");
            if (runInterval) clearInterval(runInterval);
            if (wakeInterval) clearInterval(wakeInterval);

            // Make copies of data (to avoid modifying originals)
            var playerDataCopy = JSON.parse(JSON.stringify(playerData));
            var characterDataCopy = JSON.parse(JSON.stringify(characterData));

            if (playerDataFile && characterDataFile) {
                saveData(playerDataFile, playerDataCopy);
                saveData(characterDataFile, characterDataCopy);
            } else {
                logging.warn("Data not saved.");
            }

            logging.log("Cleaning up...");
            monitor.cleanup(playerDataCopy, characterDataCopy, callback);
        }

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

        // check how long app has been running
        app.get("/up/", function(req, res){
            var startDate = new Date(startTime);
            var upTime = Date.now() - startTime;
            res.send("<h1>Up since " + startDate.toUTCString() + "</h1><h2>" + Math.floor(upTime/36e5) + " hrs, " + Math.floor((upTime/6e4) % 60) + " mins, " + Math.floor((upTime/1e3) % 60) + " secs</h2>");
        });

        // rudamentary acquiring of online players or characters
        app.get("/online/", function(req, res) {
            var playerTags = req.query.pid || "";
            var characterTags = req.query.cid || "";

            var taggedPlayers = {};
            playerTags.split(',').forEach(function(id, index) {
                taggedPlayers[id] = id; // tag players
            });

            var taggedCharacters = {};
            characterTags.split(',').forEach(function(id, index) {
                taggedCharacters[id] = id; // tag characters
            });

            var onlineList = [];

            var characterPlayers = {}; // set of players that have active characters

            // build list of online characters
            Object.keys(onlineCharacterData).forEach(function(id, index) {
                var characterEntry = onlineCharacterData[id];
                characterPlayers[characterEntry.player.id] = characterEntry.player.id; // mark that the player has a character online
                var cData = characterData[id];

                onlineList.push({
                    portrait: cData.portrait,
                    player: {
                        name: characterEntry.player.name,
                        id: characterEntry.player.id
                    },
                    character: {
                        name: characterEntry.name,
                        id: characterEntry.id
                    },
                    client: {
                        name: characterEntry.client.name,
                        id: characterEntry.client.id
                    },
                    joined: cData.logs[cData.logs.length - 1].joined,
                    tagged: !!taggedCharacters[characterEntry.id] || !!taggedPlayers[characterEntry.player.id]
                });
            });

            // build list of online players
            Object.keys(onlinePlayerData).forEach(function(id, index) {
                if (characterPlayers[id]) return; // skip any players that have online characters

                var playerEntry = onlinePlayerData[id];
                var pData = playerData[id];

                onlineList.push({
                    portrait: pData.portrait,
                    player: {
                        name: playerEntry.name,
                        id: playerEntry.id
                    },
                    character: null,
                    client: {
                        name: playerEntry.latestClient().name,
                        id: playerEntry.latestClient().id
                    },
                    joined: pData.logs[pData.logs.length - 1].joined,
                    tagged: !!taggedPlayers[playerEntry.id]
                });
            });

            // sort online list
            onlineList.sort(function(a, b) {
                // tagged items on top
                if (a.tagged && !b.tagged)
                    return -1;
                else if (!a.tagged && b.tagged)
                    return 1;
                else { // players on top
                    if (!a.character && b.character) {
                        return -1;
                    } else if (a.character && !b.character) {
                        return 1;
                    } else { // alphabetical
                        var aName = a.character ? a.character.name : a.player.name;
                        var bName = b.character ? b.character.name : b.player.name;
                        var nameCompare = aName.localeCompare(bName);
                        if (nameCompare !== 0)
                            return nameCompare;
                        else // oldest on top
                            return a.joined - b.joined;
                    }
                }
            });

            res.send(JSON.stringify(onlineList));
        });

        // start app
        var listener = app.listen(getEnvVar(process.env.PORT) || 3000, function() {
            console.log("##### App is running on port %d. Server will be polled every %d seconds. #####"
                , listener.address().port
                , pollFreq / 1000);
        });
    }

    function getEnvVar(variable) { // ensure only set env values are accepted
        if (variable && variable !== "undefined")
            return variable;
        else
            return undefined;
    }

    //// Player Data File Handling ////

    function saveData(dataFile, jsonData) {
        try {
            // Write JSON to file (sync to prevent app from exiting before write is complete)
            fs.writeFileSync(dataFile, JSON.stringify(jsonData));
            logging.log("Data successfully saved to %s", dataFile);
        } catch (e) {
            logging.error("Failed to write data to file %s", dataFile);
            throw(e);
        }
    }

    function restoreData(dataFile) {
        if (dataFile && fs.existsSync(dataFile)) {
            try {
                // Read JSON player data (sync to ensure it is fully parsed before app continues)
                var restoredData = JSON.parse(fs.readFileSync(dataFile).toString());
                logging.log("Data successfully restored from %s", dataFile);
                return restoredData;
            } catch (e) {
                logging.error("Error in data file %s. Data not restored.", dataFile);
                throw(e);
            }
        } else {
            logging.warn("Data file \"%s\" doesn't exist. Data not restored.", dataFile);
            return {};
        }
    }

    //// MISC ////

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    return publicServer;
}