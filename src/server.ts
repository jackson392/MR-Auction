/* 
                                                                        ....:::.          
                                                    ....:::::-----==============:         
                                 ....::::-----==================================:         
            .....::::-----======================================================-         
       .-=======================================================================-         
       -=========================================================================         
       -============================================================-:..    ..:==:        
       :==================================--:::=====:.       .-====:    ...     --        
       .=============---==:::.=====-    -=:    ===:    .::.    :==:    -====:::--=        
        ==....          ==    -====-    :=-    -=:    -=====:--===.   :===========.       
        -=         ..:::==.   :=====    .=-    :=.   .============.   .======-:::-.       
        -======.   -======:    ..       .==    .=:    =======:-:-=:    -====-    =:       
        :======:   .======-              ==    .=-    :=====.   :==:    .::.    :=:       
        .======-    ======-    --====    ==:   .==-.    ...    :====-:.      .:-==-       
         =======    -======    ======.   -==    ====-:.     .:===========--========       
         -======.   :======.   -=====:...-==:::-===================================.      
         :======: ..:======----====================================================:      
         .========================================================================-       
         .=======================================================-----:::::....           
          ===================================----::::::.....       .    .::---:.          
          -===============-----:::......           .:::.   --=======.  -==-:::-=.         
           .::.....            .:::.     .====-    ====-   -==..      .===:..             
                 :-====-:      =====.     =====:  -==-==   -==:::::.   :-=======:         
               .==-:..:=-:    .==::==.    -=::==. ==::==.  :===-:::.        ..-==.        
               -==.           :==. -=-    -=- :==.==..==.  .==-        :=-:..:-==         
               -==.  :----:   -==::-==-   :==  -====  ==:  .===-----=: .--====-:.         
               -==:  ..:==-  :==--:::==-  :==. .===-  -=:   --:::::...                    
                -==-:::-===  ===.    :--:  ::.  ...                                       
                 .:----. ::  ..                                                     
                 
                     
    ! Written by Spencer - team@thicc.games
    ? Developed with keyboards and pixie dust.
*/

/* IMPORTS */
import Express, { Router, json } from 'express';
import crypto from "crypto"
import { MongoClient } from 'mongodb';

/* TYPES */
interface ClaimedAuction {
    UID: string,
    sellerID: number
}

interface PurchaseHistoryObject {
    UID: string,
    itemID: string,
    itemClass: string
    price: number,
    trend: number,
}

type AuctionData = {
    sellerID: number,
    price: number,
    quantity: number,
    length: number,
    itemID: string,
    itemClass: string
    UID: string,
}

interface DataCache {
    [className: string]: {
        [itemID: string]: AuctionData[]
    }
}

interface RapCache {
    [className: string]: {
        [itemID: string]: number
    }
}

/* CONSTANTS */
const server = Express();
const routes = Router();
const port = process.env.PORT || 3333;
const uri = "mongodb+srv://spencer:spencerissexy@cluster0.hkjxzbm.mongodb.net/";
const client = new MongoClient(uri);
const serverCache: Map<string, string> = new Map();

let totalAuctionCount = 0;

/* FUNCTIONS */
function generateUID(){
    return crypto.randomBytes(16).toString("hex");
}

function isAuthenticated(placeID: string, jobID: string, secret: string) {
    if (!placeID || !jobID || !secret) return false;
    return serverCache.get(jobID) === secret;
}

/* ROUTES */
routes.get("/connect", (req, res) => {
    const placeID = req.header("roblox-id");
    const jobID = req.header("roblox-job");

    if (!placeID || !jobID) return res.status(400).send({ success: false, msg: "Missing placeID or jobID"});
    if (serverCache.has(jobID)) return res.status(400).send({ success: false, msg: "Job already connected"});

    const secret = generateUID();
    serverCache.set(jobID, secret);
    return res.status(200).send({ success: true, totalAuctionCount: totalAuctionCount, secret: secret});
});

routes.get("/disconnect", (req, res) => {
    const placeID = req.header("roblox-id");
    const jobID = req.header("roblox-job");
    const secret = req.header("roblox-secret");

    if (!isAuthenticated(placeID, jobID, secret)) return res.status(401).send("Unauthorized");

    const success = serverCache.delete(jobID);
    return res.status(success ? 200 : 400).send({ success: success });
});

routes.post("/heartbeat", async (req, res) => {
    const placeID = req.header("roblox-id");
    const jobID = req.header("roblox-job");
    const secret = req.header("roblox-secret");

    if (!isAuthenticated(placeID, jobID, secret)) return res.status(401).send({ success: false, msg: "Unauthorized" });

    const playersIds = req.body.playerIds as number[];
    if (!playersIds) return res.status(400).send({ success: false, msg: "Missing players" });

    const playerAuctionsMap: ClaimedAuction[] = [];
    const dataCache: DataCache = {};
    const purchaseHistory: PurchaseHistoryObject[] = [];
    const rapCache: RapCache = {};

    // fetch all auctions and insert into dataCache
    await client.db("MyRestaurant").collection("auctions").find().forEach((auction) => {
        if (!dataCache[auction.itemClass]) dataCache[auction.itemClass] = {};
        if (!dataCache[auction.itemClass][auction.itemID]) dataCache[auction.itemClass][auction.itemID] = [];

        dataCache[auction.itemClass][auction.itemID].push({
            sellerID: auction.sellerID,
            price: auction.price,
            quantity: auction.quantity,
            length: auction.length,
            itemID: auction.itemID,
            itemClass: auction.itemClass,
            UID: auction.UID
        });
    });

    // fetch all claimedAuctions at playerId key
    playersIds.forEach((playerId) => {
        client.db("MyRestaurant").collection("claimedAuctions").find({ sellerID: playerId }).forEach((auction) => {
            playerAuctionsMap.push({
                UID: auction.UID,
                sellerID: auction.sellerID,
            });
        });
    });

    // fetch all claimedAuctions sorted by time and insert into purchaseHistory and limit it to the last 35 auctions
    // calculate trend by averaging the last 5 auctions and comparing to current price (trend = 1 if it has increased, -1 if it has decreased, 0 if it has stayed the same)
    // calculate RAP of item by averaging the last 5 auctions
    await client.db("MyRestaurant").collection("claimedAuctions").find().sort({ time: -1 }).limit(35).forEach((auction) => {
        // @ts-ignore
        const trend = purchaseHistory.filter((auction) => auction.itemClass === auction.itemClass && auction.itemID === auction.itemID).length < 5 ? 0 : purchaseHistory.filter((auction) => auction.itemClass === auction.itemClass && auction.itemID === auction.itemID).slice(0, 5).reduce((a, b) => a.price + b.price) / 5 > auction.price ? -1 : purchaseHistory.filter((auction) => auction.itemClass === auction.itemClass && auction.itemID === auction.itemID).slice(0, 5).reduce((a, b) => a.price + b.price) / 5 < auction.price ? 1 : 0;

        purchaseHistory.push({
            UID: auction.UID,
            itemID: auction.itemID,
            itemClass: auction.itemClass,
            price: auction.price,
            trend: trend
        });

        if (!rapCache[auction.itemClass]) rapCache[auction.itemClass] = {};
        if (!rapCache[auction.itemClass][auction.itemID]) rapCache[auction.itemClass][auction.itemID] = 0;

        rapCache[auction.itemClass][auction.itemID] += auction.price;
    });

    // calculate RAP of item by averaging the auctions with that class and itemID
    Object.keys(rapCache).forEach((itemClass) => {
        Object.keys(rapCache[itemClass]).forEach((itemID) => {
            rapCache[itemClass][itemID] /= purchaseHistory.filter((auction) => auction.itemClass === itemClass && auction.itemID === itemID).length;
        });
    });

    // convert dataCache to json
    return res.status(200).send({ 
        totalAuctionCount: totalAuctionCount,
        claimedAuctions: playerAuctionsMap,
        dataCache: dataCache,
        purchaseHistory: purchaseHistory,
        rapCache: rapCache,
        success: true
    });
});

routes.post("/createAuction", async (req, res) => {
    const placeID = req.header("roblox-id");
    const jobID = req.header("roblox-job");
    const secret = req.header("roblox-secret");

    if (!isAuthenticated(placeID, jobID, secret)) return res.status(401).send({ success: false, msg: "Unauthorized" });

    const auction = req.body as AuctionData;
    if (!auction) return res.status(400).send({ success: false, msg: "Missing auction" });

    const { sellerID, price, quantity, length, itemID, itemClass } = auction;
    const itemUID = generateUID();

    await client.db("MyRestaurant").collection("auctions").insertOne({
        UID: itemUID,
        sellerID: sellerID,
        price: price,
        quantity: quantity,
        length: length,
        itemID: itemID,
        itemClass: itemClass,
    });

    totalAuctionCount++;

    return res.status(200).send({ 
        success: true,
        UID: itemUID,
        totalAuctionCount: totalAuctionCount
    });
});

routes.post("/purchaseAuction", async (req, res) => {
    const placeID = req.header("roblox-id");
    const jobID = req.header("roblox-job");
    const secret = req.header("roblox-secret");

    if (!isAuthenticated(placeID, jobID, secret)) return res.status(401).send({ success: false, msg: "Unauthorized" });

    const playerID = req.body.buyerID as number;
    const playerCash = req.body.buyerCash as number;
    const itemUID = req.body.itemUID as string;

    if (!playerID || !itemUID || !playerCash) return res.status(400).send({ success: false, msg: "Missing playerID or itemUID or playerCash" });

    // get auction data, if it exists and is not owned by the player, then delete it and insert it into claimedAuctions
    const auction = await client.db("MyRestaurant").collection("auctions").findOneAndDelete({ UID: itemUID, sellerID: { $ne: playerID } });
    if (!auction) return res.status(200).send({ success: false, msg: "Unknown error" });
    if (!auction.value) return res.status(400).send({ success: false, msg: "Auction does not exist or is owned by the player" });

    // check if player has enough cash
    if (playerCash < auction.value.price) return res.status(400).send({ success: false, msg: "Player does not have enough cash" });

    const { UID, sellerID, price, quantity, length, itemID, itemClass } = auction.value;
    await client.db("MyRestaurant").collection("claimedAuctions").insertOne({
        UID: UID,
        sellerID: sellerID,
        price: price,
        quantity: quantity,
        length: length,
        itemID: itemID,
        itemClass: itemClass,
        time: new Date()
    });

    totalAuctionCount--;

    return res.status(200).send({
        success: true,
        totalAuctionCount: totalAuctionCount,

        itemClass: itemClass,
        itemID: itemID,
        price: price,
        quantity: quantity
    });
});

routes.post("/cancelAuction", async (req, res) => {
    const placeID = req.header("roblox-id");
    const jobID = req.header("roblox-job");
    const secret = req.header("roblox-secret");

    if (!isAuthenticated(placeID, jobID, secret)) return res.status(401).send({ success: false, msg: "Unauthorized" });

    const playerID = req.body.playerID as number;
    const itemUID = req.body.itemUID as string;
    if (!playerID || !itemUID) return res.status(400).send({ success: false, msg: "Missing playerID or itemUID" });

    // check if the auction exists and is owned by the player, then delete it
    const auction = await  client.db("MyRestaurant").collection("auctions").findOneAndDelete({ UID: itemUID, sellerID: playerID });
    if (!auction) return res.status(200).send({ success: false, msg: "Unknown error" });
    if (!auction.value) return res.status(400).send({ success: false, msg: "Auction does not exist or is not owned by the player" });

    totalAuctionCount--;

    return res.status(200).send({
        success: true,
        totalAuctionCount: totalAuctionCount
    });
});

routes.post("/extendAuction", async (req, res) => {
    const placeID = req.header("roblox-id");
    const jobID = req.header("roblox-job");
    const secret = req.header("roblox-secret");

    if (!isAuthenticated(placeID, jobID, secret)) return res.status(401).send({ success: false, msg: "Unauthorized" });

    const playerID = req.body.playerID as number;
    const itemUID = req.body.itemUID as string;
    if (!playerID || !itemUID) return res.status(400).send({ success: false, msg: "Missing playerID or itemUID" });

    // check if the auction exists and is owned by the player, then extend it by 1 day (86400s)
    const auction = await client.db("MyRestaurant").collection("auctions").updateOne({ itemUID: itemUID, sellerID: playerID }, { $inc: { length: 86400 } });
    if (!auction) return res.status(200).send({ success: false, msg: "Unknown error" });
    if (auction.modifiedCount == 0) return res.status(400).send({ success: false, msg: "Auction does not exist or is not owned by the player" });

    return res.status(200).send({
        success: true,
        totalAuctionCount: totalAuctionCount
    });
});

routes.get("/getAuctionCount", (req, res) => {
    return res.status(200).send({
        totalAuctionCount: totalAuctionCount,
        success: true
    });
});

routes.get("/", (req, res) => {
    return res.status(200).send("You are not allowed here!");
});

// create an async function to check for expired auctions
async function checkForExpiredAuctions() {
    await client.db("MyRestaurant").collection("auctions").updateMany({}, { $inc: { length: -1 } });
    await client.db("MyRestaurant").collection("auctions").find({ length: { $lte: 0 } }).forEach((auction) => {
        const { UID, sellerID, price, quantity, length, itemID, itemClass } = auction;
        client.db("MyRestaurant").collection("claimedAuctions").insertOne({
            UID: UID,
            sellerID: sellerID,
            price: price,
            quantity: quantity,
            length: length,
            itemID: itemID,
            itemClass: itemClass,
            time: new Date()
        });
    });

    await client.db("MyRestaurant").collection("auctions").deleteMany({ length: { $lte: 0 } });
}

/* CONCLUSION */
async function main() {
    await client.connect();
    server.use(json());
    server.use(routes);
    server.listen(port);

    // fetch total auction count
    totalAuctionCount = await client.db("MyRestaurant").collection("auctions").countDocuments();
    console.log("Total auction count: " + totalAuctionCount);

    // run checkForExpiredAuctions every second
    setInterval(checkForExpiredAuctions, 1000);
}

main().catch(console.error);
