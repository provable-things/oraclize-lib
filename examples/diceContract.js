// imports
var oraclize = require('../index.js');
var bitcoin = require('bitcoinjs-lib');
var request = require('request');

// set network
var network = bitcoin.networks.testnet;
// gross amount contract will payout in satoshis
var contractPayoutGross = 108e4;
// tx fee to be used
var fee = 8e4;
// gross payout minus tx fee
var contractPayout = contractPayoutGross - fee;

// declare parties to partake in contract, in bitcoinjs-lib ECPair object format

// 1. let's setup the keys
var network = bitcoin.networks.testnet
var ALICE = bitcoin.ECPair.fromWIF('cMkopUXKWsEzAjfa1zApksGRwjVpJRB3831qM9W4gKZsLwjHXA9x', network)
var BOB = bitcoin.ECPair.fromPublicKeyBuffer(new Buffer('0294e816def756545ddc058309f729d2fe986e10b9d3dc740268c08c14d666d952', 'hex'), network);

// 2. we create two paired Oraclize Contracts based on a simple bet. Bob wins, if the return number is greater than 50, Alice wins if it is not.
var now = new Date().getTime() / 1000 | 0;
var betContract_AliceWins = new oraclize.helpers.bitcoin.Contract({ daterange: [now + 120], interval: 60 });
var betContract_BobWins = new oraclize.helpers.bitcoin.Contract({ daterange: [now], interval: 60 });

// 3. Define first condition set, ALICE wins if it is less than or equal to, BOB wins if it is greater than
// Their appropriate check operations will be done when applying the conditions
var condA_params = { datasource: 'WolframAlpha', query: 'random number between 1 and 100', value: 50 };


// 4. Apply the conditions to their respective Contracts
betContract_AliceWins.applyConditions([
  new oraclize.Condition({})
]);
betContract_BobWins.applyConditions([
  new oraclize.Condition(Object.assign(condA_params, { checkOp: 'gt' }))
]);

// 5. Initializing the Bitcoin P2SH escrow contract with previously declared contract parameters
// Note ALICE has been set as the locktime signer, as she will be considered to be the first one depositing funds

var betEscrowAddress = new oraclize.helpers.bitcoin.ConditionalEscrowAddress({
  // declare keys, required for partipants
  keys: [ALICE, BOB],
  contracts: [{ object: betContract_AliceWins, cosigner: BOB }, { object: betContract_BobWins, cosigner: ALICE }],
  lockTime: { ts: now + 3600, signer: ALICE }
}, ALICE_PrepareAndSubmit.bind(this));

function ALICE_PrepareAndSubmit() {
  // 6. Alice loads escrow with BTC
  console.log('Waiting for funds to be sent to P2SH escrow, send ' + contractPayoutGross + ' satoshis');
  // TODO add user input wait
  console.log('Waiting 60 seconds before attempting submission...');


  setTimeout(function () {
    // 7. Wait a bit for bob to also fund the escrow then Alice prepares and submits her portion of the contract
    betContract_BobWins.prepare({ outputs: [{ value: contractPayout, address: BOB.getAddress() }], signer: ALICE, network: network }, function () {
      console.log(`Alice's submission`);
      betContract_BobWins.submit();
    });
  }, 65000);


  // 8. Bob funds the contract for execution and then prepares and submits his portion of the contract
  BOB_PrepareAndSubmit(betContract_AliceWins, contractPayout);
}


// From Bob's computer
function BOB_PrepareAndSubmit(contract, payout) {
  // 9. Bob uses his WIF
  var BOB_WIF = bitcoin.ECPair.fromWIF('cTDQzWnzwv1ceovPTjMU3x5ewEivLZZZcQjVW87VhjtZP6Xv5wTL', network)

  setTimeout(function () {
    // 10. Bob signs off, and contract starts
    contract.prepare({ outputs: [{ value: payout, address: ALICE.getAddress() }], signer: BOB_WIF, network: network }, function () {

      console.log(`Bob's submission`);
      contract.submit();
    });
  }, 65000);

}
