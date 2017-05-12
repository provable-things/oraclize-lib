// imports
var fs = require('fs');
var oraclize = require('../index.js');
var bitcoin = require('bitcoinjs-lib');
var request = require('request');

// set network
var network = bitcoin.networks.testnet;
// gross amount contract will payout in satoshis
var contractPayoutGross = 20e4;
// tx fee to be used
var fee = 2e4;
// gross payout minus tx fee
// divide by 2 as there will be 2 separate conditions and payouts associated
var contractPayout = contractPayoutGross / 2 - fee;

// declare parties to partake in contract, in bitcoinjs-lib ECPair object format

// WIF/private key only required for cosigners, who can be looked at as the sellers of the contract
var ALICE = bitcoin.ECPair.fromWIF('cMkopUXKWsEzAjfa1zApksGRwjVpJRB3831qM9W4gKZsLwjHXA9x', network);

// BOB can simply build ecpair from public key, as bob does not need to sign for preparation
// and submission of the contracts
var BOB = bitcoin.ECPair.fromPublicKeyBuffer(new Buffer('0294e816def756545ddc058309f729d2fe986e10b9d3dc740268c08c14d666d952', 'hex'), network);


// create a new contract

/*
  This contract will payout Bob, if the temperature in Milan, is above 10 degrees
  celsius starting from broadcast of the transaction, or if it's rainy, until 24 hours pass, checked hourly via Wolfram Alpha until a condition matches or daterange expires.
*/


// set daterange upon which oraclize will check and execute the contained contract conditions
// interval for checks defaults to hourly interval
var now = new Date().getTime() / 1000 | 0;
var dayInSeconds = 60 * 60 * 24;
var contract = new oraclize.helpers.bitcoin.Contract({ daterange: [now, now + dayInSeconds] });


// declare parameters for oraclize bitcoin contract
var params = {};
// choose datasource for query
params.datasource = 'WolframAlpha';
// define query
params.query = 'What is the temperature in Milan, Italy?';
// define check operation to use for value parameter, > == greater than
params.checkOp = '>';
// define value to check
params.value = 10;


// create new contract condition object using parameters
var contractConditions1 = new oraclize.Condition(params);

// reusing previous params object
params.query = 'Weather conditions in Milan, Italy';
params.checkOp = 'contains';
params.value = 'rain';

var contractConditions2 = new oraclize.Condition(params);

// apply the conditions to contract and use appropriate separator
contract.applyConditions([
  contractConditions1,
  'or',
  contractConditions2
]);

// In this test case, a testnet faucet will be used to fund the conditional
// escrow address of the contracts

// keep track of faucet tx for debug purposes
var faucetTx;

// initialize escrow address for the contract

var escrowAddress = new oraclize.helpers.bitcoin.ConditionalEscrowAddress({
  // declare keys via ECPair, required for all participants
  keys: [ALICE, BOB],
  // enter contracts and the associated cosigners for them
  // cosigners are required to sign off on them, after this step
  contracts: [{ object: contract, cosigner: ALICE }],
    // if daterange passes, conditions are unmet, and oraclize doesn't sign off
    // the locktime signer is able to retrieve any remaining funds from the escrow unilaterally
  lockTime: { ts: now + dayInSeconds, signer: ALICE }
}, contractPrepareAndSubmit.bind(this));
function contractPrepareAndSubmit() {
  console.log('Waiting for P2SH escrow to be funded');

  // Set up an interval checker to wait for escrow to be loaded
  var checker = setInterval(function () {
    request('https://api.blockcypher.com/v1/btc/test3/txs/' + faucetTx, function (error, response, body) {
      try {
        var parsed = JSON.parse(body);
        if (typeof parsed.error !== 'undefined')
          throw new Error;

      } catch (e) {
        return;
      }

      if (typeof faucetTx === 'undefined') {
        console.log('Still waiting on faucet tx broadcast to occur.');
        return;
      } else {
        clearInterval(checker);
      }

      commitPrepareAndSubmit();
    });
  }, 5000);
}

function commitPrepareAndSubmit() {
  // prepare the temparature contract for submission, by declaring the correct outputs
  // outputs require a value parameter, for amount to send in the output, and address associated
  // within the signer variable, the previously assigned cosigner must provide their key for signing off
  // bitcoin-js lib network parameter is required as well
  contract.prepare({ outputs: [{ value: contractPayout, address: BOB.getAddress() }], signer: ALICE, network: network }, function () {
    // output the generated raw tx for showcase
    fs.writeFileSync('milanContractRawTx.txt', contract.output.actions[0].args.raw_tx);

    // contract is prepared, and can now be submitted to oraclize, which will
    // print the associated oraclize query id to console
    contract.submit();
  });


}
