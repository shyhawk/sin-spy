var request = require("request");
var express = require("express");
var app = express();

var clients = { // locations by chatClient
    "web": "Webclient",
    "5121": "Sinfar",
    "5122": "The Dreaded Lands",
    "5123": "Sinfar's Outer Isles",
    "5124": "Arche Terre"
};
var onlinePlayers = [];
var playerData = {};


// initial call
updateOnlinePlayers();
// check for updates every 30 seconds
var interval = setInterval(function() {
    console.log("=================================================");
    updateOnlinePlayers();
}, process.env.POLL_FREQ);

// get dump of current player data
app.get("/data/", function(req, res) {
    res.send(escapeHtml(JSON.stringify(playerData)));
});

app.listen(3000);

console.log("##### App is running. Server will be polled every %d seconds. #####", process.env.POLL_FREQ / 1000);

//// Player Data Handling ////

function updateOnlinePlayers() {
    request("http://nwn.sinfar.net/getonlineplayers.php", function(error, response, body) {
        if (!error && response.statusCode == 200) {
            var playerList = JSON.parse(body);
            updatePlayerData(playerList);
        } else {
            console.error("Error %s: \"%s\" when acquiring player list", response.statusCode, error);
        }
    });
}

function updatePlayerData(currentOnlinePlayers) {
    if (currentOnlinePlayers) {
        var newOnlinePlayersList = [];
        currentOnlinePlayers.forEach(function(player, index) {
            newOnlinePlayersList.push(player.playerId); // keep track of which players are online
            var pData = playerData[player.playerId];

            if (!pData) { // player has no record
                pData = playerData[player.playerId] = {};
            }

            if (onlinePlayers.indexOf(player.playerId) < 0) { // player just logged in
                playerJoined(player, pData);
                if (!player.pcId) { // logged in and not playing character
                    console.log("%s logged into %s", player.playerName, getClientName(player.chatClient));
                }
            }

            if (pData.activeCharacter || player.pcId) {
                if (!player.pcId) { // logged out as character
                    var charName = pData.characters[pData.activeCharacter].name;
                    var oldClient = pData.client;
                    characterLeft(pData, player.webClient);
                    console.log("%s logged out of %s as %s", player.playerName, getClientName(oldClient), charName);
                } else if (!pData.activeCharacter) { // logged in as character
                    characterJoined(player, pData);
                    console.log("%s logged into %s as %s", player.playerName, getClientName(player.chatClient), player.pcName);
                } else if (pData.activeCharacter != player.pcId) { // switched characters
                    var oldCharName = pData.characters[pData.activeCharacter].name;
                    var oldClient = pData.client;
                    characterSwitched(player, pData);
                    console.log("%s logged out of %s as %s and into %s as %s", player.playerName, getClientName(oldClient), oldCharName, getClientName(player.chatClient), player.pcName);
                }
            }
        });

        // get list of players that are no longer online
        var loggedPlayers = onlinePlayers.filter(function(p) {
            return newOnlinePlayersList.indexOf(p) < 0;
        });

        // log out players
        loggedPlayers.forEach(function(playerId, index) {
            var pData = playerData[playerId];
            if (pData) {
                var oldClient = pData.client;
                playerLeft(pData);
                console.log("%s logged out of %s", pData.name, getClientName(oldClient));
            }
        });

        onlinePlayers = newOnlinePlayersList; // update online list
    }
}

function playerJoined(player, pData) {
    if (!pData.id) { // new player; initialize
        pData.id = player.playerId;
        pData.name = player.playerName;
        pData.characters = {};
        pData.logs = [];
    }

    var newLog = {
        joined: Date.now()
    };
    pData.logs.push(newLog);

    pData.client = player.chatClient;
}

function updateCharacterData(player, cData) {
    // only update character name and portrait if valid new values exist
    if (player && player.pcName) cData.name = player.pcName;
    if (player && player.portrait) cData.portrait = player.portrait;

    getCharacterDescription(cData.id, function(desc) {
        cData.description = desc;
    }); // get description
}

function characterJoined(player, pData) {
    var joinedCharacter = pData.characters[player.pcId];
    if (!joinedCharacter) {
        joinedCharacter = pData.characters[player.pcId] = {};
        joinedCharacter.id = player.pcId;
        joinedCharacter.logs = [];
    }

    // update character data that could have been changed
    updateCharacterData(player, joinedCharacter);

    var newLog = {
        joined: Date.now()
    };
    joinedCharacter.logs.push(newLog);

    pData.activeCharacter = player.pcId;
    pData.client = player.chatClient;
}

function characterSwitched(player, pData) {
    characterLeft(pData, player.webClient);
    characterJoined(player, pData);
}

function characterLeft(pData, client) {
    var cData = pData.characters[pData.activeCharacter];

    // update character data that could have been changed in-game
    updateCharacterData(null, cData);

    // get latest log, modify it, and return it
    var latestLog = cData.logs.pop();
    latestLog.quit = Date.now();
    cData.logs.push(latestLog);

    pData.activeCharacter = null; // clear active character
    pData.client = client;
}

function playerLeft(pData) {
    if (pData.activeCharacter)
        characterLeft(pData, null);

    // get latest log, modify it, and return it
    var latestLog = pData.logs.pop();
    latestLog.quit = Date.now();
    pData.logs.push(latestLog);
}

function getClientName(client) {
    return clients[client] || (client === null ? "Offline" : "Other");
}

function getCharacterDescription(characterId, callback) {
    request("http://nwn.sinfar.net/getcharbio.php?pc_id=" + characterId, function(error, response, body) {
        if (!error && response.statusCode == 200) {
            callback(body !== "ERROR1" ? body : "");
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