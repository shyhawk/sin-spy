var server = require("./server.js")(); // begin server

// Ctrl+C exit
process.on("SIGINT", function() {
    cleanExit(0);
});

// termination signal
process.on("SIGTERM", function() {
    cleanExit(0);
});

// Error exit
process.on("uncaughtException", function(err){
    console.dir (err, { depth: null });
    cleanExit(1);
});

function cleanExit(code) {
	server.shutdown(function() {
		console.log("Cleaned successfully. Shutdown.");
		process.exit(code); // clean shutdown
	});
}