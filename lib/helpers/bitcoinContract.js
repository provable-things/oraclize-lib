'use strict';

var Contract = require('../contract');
var Action = require('../action');
var utils = require('../utils');
var request = require('request');
var bitcoin = require('bitcoinjs-lib');
var coinSelect = require('coinselect');

function BitcoinContract(options) {
    Contract.call(this, options);

    this.isBitcoinSpecial = true;
    this.lock = false;
}

// Inherit contract's methods
BitcoinContract.prototype = Object.create(Contract.prototype);

// override prototypes as needed
BitcoinContract.prototype.applyActions = function () {
    throw new Error('This specific helper auto-manages actions for you, hence you cannot set them manually. If you want to do it anyway use the raw oraclize.Contract object instead.');
};

BitcoinContract.prototype.getChecks = function (remote) {
    //#FIXME should contract be unlocked after submission????
    // This unlocks the contract
    if (this.lock && typeof this.oraclizeId !== 'undefined')
        utils.writeProtected(this, 'lock', false);

    Contract.prototype.getChecks.call(this, remote);
};

//set actions and tx in here
BitcoinContract.prototype.prepare = function (options) {
    // outputX format is {‘value’: 1234, ‘address’: ‘..’}

    var self = this;
    request('https://bitcoinfees.21.co/api/v1/fees/recommended', function (error, response, body) {
        var feeRate
        if (!error)
            feeRate = JSON.parse(body).halfHourFee;

        // internal fallback for feeRate
        if (error || isNaN(feeRate)) {
            feeRate = 90; // current cheapest and fastest rate
            console.log('There was some issue fetching the feeRate... falling back to default rate of ' + feeRate)
        }

        request("https://test-insight.bitpay.com/api/addr/" + self.contractAddress + "/utxo", function (error, response, body) {
            if (error)
                console.log(error);
            var unspent = JSON.parse(body);

            unspent.forEach(function (input, index) {
                unspent[index].value = input.satoshis;
                delete unspent[index].satoshis;
            });

            if (arraySum(unspent, 'value') < arraySum(options.outputs, 'value'))
                console.log("NOT ENOUGH FUNDS");

            var tx = new bitcoin.TransactionBuilder(network)
            tx.setLockTime(self.lockTime);

            var targets = options.outputs.filter(function (obj) {
                return typeof obj.address !== 'undefined' && obj.value > 0;
            });
            var ops = options.outputs.filter(function (obj) {
                return typeof obj.value === 'undefined' && typeof obj.data !== 'undefined';
            });
            // format unspents for coinSelect;

            var selectedCoins = coinSelect(unspent, targets, feeRate);
            var inputs = selectedCoins.inputs;
            var outputs = selectedCoins.outputs;
            if (!inputs || !outputs) {
                console.log('Preparation failed... coinselect was unable to find inputs/output solution.');
                return;
            }

            console.log(selectedCoins);
            console.log('Expected fee is ' + selectedCoins.fee);

            inputs.forEach(function (input) {
                tx.addInput(input.txid, input.vout);
            });

            outputs = outputs.concat(ops);
            var warn;

            outputs.forEach(function (output) {
                if (output.value > 0) {
                    if (!output.address)
                        output.address = self.contractAddress;

                    tx.addOutput(output.address, output.value);

                } else if (typeof output.data !== 'undefined') {
                    if (warn) {
                        warn = false;
                        console.log('WARN: This transaction already has one OP_RETURN... Having additional ones will create a non-standard transaction that will not be relayed by regular nodes... proceed with this at your own discretion.')
                    }

                    if (typeof warn === undefined)
                        warn = true;

                    var opRet = bitcoin.script.compile([
                        bitcoin.opcodes.OP_RETURN,
                        new Buffer(output.data)
                    ]);
                    tx.addOutput(opRet, 0);
                }
            });

            var txRaw = tx.buildIncomplete();

            var hashType = bitcoin.Transaction.SIGHASH_ALL;
            var redeemScript = self.redeemScript;
            var ORACLIZE_MARKER = new Buffer('ORACLIZE');

            txRaw.ins.forEach(function (input, index) {
                var signatureHash = txRaw.hashForSignature__(index, redeemScript, hashType, getSubScriptBuffer(redeemScript, ORACLIZE_MARKER));
                var sig = options.signer.sign(signatureHash).toScriptSignature(hashType);
                var redeemScriptSig = bitcoin.script.scriptHash.input.encode([sig], redeemScript);
                txRaw.setInputScript(index, redeemScriptSig)
            });

            addActionsBTC(self, txRaw);
        });
    });
};

function addActionsBTC(self, txRaw) {
    utils.writeProtected(self, 'lock', false);

    var actionIndex;

    if (typeof self.output.actions === 'undefined') {
        actionIndex = 0;
        self.output.actions = [];
    } else
        actionIndex = self.output.actions.length;

    var addActions = [];

    txRaw.ins.forEach(function (input, i) {
        var rawTx;
        if (i === 0)
            rawTx = txRaw.toHex();
        else
            rawTx = Action.future.result(actionIndex);

        var signAction = {
            type: 'btc_signTransaction',
            args: {
                network: 'btc_testnet',
                oraclize_pubkey: '038ea27103fb646a2cea9eca9080737e0b23640caaaef2853416c9b286b353313e',
                vin: i,
                raw_tx: rawTx
            }
        };
        addActions.push(signAction);
        actionIndex++;
    });

    var sendAction = {
        type: 'btc_sendRawTransaction',
        args: {
            network: 'btc_testnet',
            raw_tx: Action.future.result(actionIndex)
        }
    };
    addActions.push(sendAction);
    utils.writeProtected(self.output, 'actions', self.output.actions.concat(addActions));
    utils.writeProtected(self, 'lock', true);
    console.log('Bitcoin contract ready to be submitted!');
}

function getSubScriptBuffer(mainScriptBuffer, condition) {
    var hconditions_len = condition.length.toString(16);
    if (hconditions_len.length < 2)
        hconditions_len = '0' + hconditions_len;
    var prefix = bitcoin.opcodes.OP_CODESEPARATOR.toString(16) + hconditions_len;
    var pos = mainScriptBuffer.toString('hex').indexOf(prefix + condition.toString('hex')); //console.log("pos= "+pos);
    if (pos == -1)
        return [];
    var subScriptB = mainScriptBuffer.slice((pos + 2) / 2); // remove OP_CODESEPARATOR
    var subScriptB_dec = bitcoin.script.decompile(subScriptB);
    var subScriptB_clean_dec = [];
    for (var i = 0; i < subScriptB_dec.length; i++) {
        if (subScriptB_dec[i] != bitcoin.opcodes.OP_CODESEPARATOR)
            subScriptB_clean_dec.push(subScriptB_dec[i]);
        }
    var subScriptB_clean = bitcoin.script.compile(subScriptB_clean_dec);
    return subScriptB_clean;
}

function arraySum(array, prop) {
    var total = 0
    for (var i = 0, _len = array.length; i < _len; i++) {
        total += array[i][prop]
    }
    return total
}

module.exports = BitcoinContract;
