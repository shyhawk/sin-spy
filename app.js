var request = require("request");
var express = require("express");
var app = express();

// currently online players and characters
var onlinePlayerData = {};
var onlineCharacterData = {};

var playerDataFile = getEnvVar(process.env.PDATA_FILE);
var characterDataFile = getEnvVar(process.env.CDATA_FILE);

// attempt to restore persistent player and character data
var playerData = restoreData(playerDataFile);
var characterData = restoreData(characterDataFile);

var monitor = require("./monitor.js")(playerData, characterData, onlinePlayerData, onlineCharacterData);

// initial call
monitor.update();
// check for updates every interval
var pollFreq = getEnvVar(process.env.POLL_FREQ) || 15000; // default to every 15 seconds
var runInterval = setInterval(function() {
    monitor.update();
}, pollFreq);

// prevent Heroku app from sleeping by having it wake itself up
var wakeInterval;
var appUrl = getEnvVar(process.env.APP_URL);
if (appUrl) {
    wakeInterval = setInterval(function() {
        request(appUrl);
    }, 1500000); // every 25 minutes
}

// On exit
process.on("exit", function(code) {
    clearInterval(runInterval);
    clearInterval(wakeInterval);

    if (playerDataFile && characterDataFile) {
    	// Make copies of data (to avoid modifying originals)
    	var playerDataCopy = JSON.parse(JSON.stringify(playerData));
    	var characterDataCopy = JSON.parse(JSON.stringify(characterData));

    	monitor.clean(playerDataCopy, characterDataCopy);

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
var listener = app.listen(getEnvVar(process.env.PORT) || 3000, function() {
    console.log("##### App is running on port %d. Server will be polled every %d seconds. #####"
        , listener.address().port
        , pollFreq / 1000);
});

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

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}