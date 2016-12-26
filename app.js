var server = require("./server.js")();

// On exit
process.on("exit", function(code) {
    server.shutdown();
});

// Ctrl+C exit
process.on("SIGINT", function() {
    process.exit(0);
});

// termination signal
process.on("SIGTERM", function() {
    process.exit(0);
});

// Error exit
process.on("uncaughtException", function(err){
    console.dir (err, { depth: null });
    process.exit (1);
});