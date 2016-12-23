var assert = require('assert');
var request = require('request');
var stringify = require('json-stable-stringify');
var bitcoin = require('bitcoinjs-lib');
var typeforce = require('typeforce');
var utils = require('../../utils');

ORACLIZE_MARKER = 'ORACLIZE';
var Transaction = bitcoin.Transaction;
var EMPTY_SCRIPT = new Buffer(0);
var ONE = new Buffer('0000000000000000000000000000000000000000000000000000000000000001', 'hex');

bitcoin.Transaction.prototype.hashForSignature__ = function (inIndex, prevOutScript, hashType, ourScript) {
    //typeforce(bitcoin.types.tuple(bitcoin.types.UInt32, bitcoin.types.Buffer, bitcoin.types.Number), arguments);
    if (inIndex >= this.ins.length)
        return ONE;
    var txTmp = this.clone(); // SIGHASH_NONE: ignore all outputs? (wildcard payee)
    if ((hashType & 0x1f) === Transaction.SIGHASH_NONE) {
        txTmp.outs = []; // ignore sequence numbers (except at inIndex)
        txTmp.ins.forEach(function (input, i) {
            if (i === inIndex)
                return;
            input.sequence = 0;
        }); // SIGHASH_SINGLE: ignore all outputs, except at the same index?
    } else if ((hashType & 0x1f) === Transaction.SIGHASH_SINGLE) {
        if (inIndex >= this.outs.length)
            return ONE; // truncate outputs after
        txTmp.outs.length = inIndex + 1; // "blank" outputs before
        for (var i = 0; i < inIndex; i++) {
            txTmp.outs[i] = BLANK_OUTPUT;
        }
        // ignore sequence numbers (except at inIndex)
        txTmp.ins.forEach(function (input, y) {
            if (y === inIndex)
                return;
            input.sequence = 0;
        });
    }
    // SIGHASH_ANYONECANPAY: ignore inputs entirely?
    if (hashType & Transaction.SIGHASH_ANYONECANPAY) {
        txTmp.ins = [txTmp.ins[inIndex]];
        txTmp.ins[0].script = ourScript; // SIGHASH_ALL: only ignore input scripts
    } else { // "blank" others input scripts
        txTmp.ins.forEach(function (input) {
            input.script = EMPTY_SCRIPT;
        });
        txTmp.ins[inIndex].script = ourScript;
    }
    // serialize and hash
    var buffer = new Buffer(txTmp.byteLength() + 4); //FIXME: __byteLength(false)
    buffer.writeInt32LE(hashType, buffer.length - 4);
    txTmp.toBuffer(buffer, 0); //FIXME: __toBuffer(buffer, 0, false)
    return bitcoin.crypto.hash256(buffer);
};

function getScript(ORACLIZE, ALICE, BOB, conditions, lockTime) {
    var script = [];
    if ((lockTime != null)&&(lockTime['Carol'] != null)&&(lockTime['ts'] != null)) {
        Array.prototype.push.apply(script, [
            bitcoin.opcodes.OP_DEPTH,
            bitcoin.opcodes.OP_1SUB,
            bitcoin.opcodes.OP_0NOTEQUAL,
            bitcoin.opcodes.OP_NOTIF, // 1 elements on the stack, lockTime based spending?
            lockTime['Carol'].getPublicKeyBuffer(),
            bitcoin.opcodes.OP_CHECKSIGVERIFY, // Carol has signed the whole script
            bitcoin.script.number.encode(lockTime['ts']),
            bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY, // but it is too early? fail!
            bitcoin.opcodes.OP_TRUE,
            bitcoin.opcodes.OP_ELSE
        ]);
    } else {
        Array.prototype.push.apply(script, [
            bitcoin.opcodes.OP_TRUE,
            bitcoin.opcodes.OP_IF,
        ]);
    }
    Array.prototype.push.apply(script, [
        bitcoin.opcodes.OP_2DUP, // let's assume we have 2 sigs, we send now a copy of both to the alt stack
        bitcoin.opcodes.OP_TOALTSTACK,
        bitcoin.opcodes.OP_TOALTSTACK,
        ALICE.getPublicKeyBuffer(),
        bitcoin.opcodes.OP_CHECKSIG, // is the first sig the one of Alice for the whole script?
        bitcoin.opcodes.OP_IF, // Alice has signed the whole script, what about Bob?
        BOB.getPublicKeyBuffer(),
        bitcoin.opcodes.OP_CHECKSIGVERIFY, // the second sig is not a valid one for Bob, fail!
        bitcoin.opcodes.OP_ELSE, // well, maybe Alice has signed a subscript then?
        bitcoin.opcodes.OP_FROMALTSTACK,
        bitcoin.opcodes.OP_FROMALTSTACK,
        bitcoin.opcodes.OP_CODESEPARATOR,
        new Buffer(ORACLIZE_MARKER),
        bitcoin.opcodes.OP_DROP,
        ALICE.getPublicKeyBuffer(),
        bitcoin.opcodes.OP_CHECKSIGVERIFY, // last chance for Alice, is this a subscript sig? If not, fail!
        bitcoin.opcodes.OP_DROP,
        ORACLIZE.getPublicKeyBuffer(),
        bitcoin.opcodes.OP_TOALTSTACK,
        bitcoin.opcodes.OP_TOALTSTACK,
        bitcoin.opcodes.OP_FALSE
    ]);
    for (var j = 0; j < conditions.length; j++) {
        Array.prototype.push.apply(script, [
            bitcoin.opcodes.OP_DUP,
            bitcoin.opcodes.OP_NOTIF,
            bitcoin.opcodes.OP_DROP,
            bitcoin.opcodes.OP_FROMALTSTACK,
            bitcoin.opcodes.OP_FROMALTSTACK,
            bitcoin.opcodes.OP_2DUP,
            bitcoin.opcodes.OP_TOALTSTACK,
            bitcoin.opcodes.OP_TOALTSTACK,
            bitcoin.opcodes.OP_CODESEPARATOR,
            conditions[j],
            bitcoin.opcodes.OP_DROP,
            bitcoin.opcodes.OP_CHECKSIG,
            bitcoin.opcodes.OP_ENDIF
        ]);
    }
    Array.prototype.push.apply(script, [bitcoin.opcodes.OP_ENDIF, bitcoin.opcodes.OP_ENDIF]);
    return script;
}

var network = bitcoin.networks.testnet
var pubKey = new Buffer('038ea27103fb646a2cea9eca9080737e0b23640caaaef2853416c9b286b353313e', 'hex');
var ORACLIZE = bitcoin.ECPair.fromPublicKeyBuffer(pubKey, network);

function ConditionalEscrowAddress(options) {
    utils.newInstanceCheck(this, ConditionalEscrowAddress);
    var hashType = bitcoin.Transaction.SIGHASH_ALL;
    var conditionMarkers = [];
    this.contracts = options.contracts;
    this.keys = options.keys;
    this.lockTime = options.lockTime || null;
    var self = this;
    this.contracts.forEach(function (contract, index, array) {
        contract.getDryMarker(function (thisContract, subcontract) {
            // verify it's a valid bitcoinContract
            if (!contract.isBitcoinSpecial)
                throw new Error('Contract at index ' + index + ' is not of the required bitcoin contract type');

            contract.id = index;
            var subcontractStable = stringify(subcontract);
            var marker = bitcoin.crypto.sha256(subcontractStable);
            conditionMarkers.push(marker);
            if (index === array.length - 1)
                setAddress(self, conditionMarkers);
            }
        );
    });
}

function setAddress(instance, conditions) {
    var keys = instance.keys;
    var lockTime = instance.lockTime;
    var decodedScript = getScript(ORACLIZE, keys[0], keys[1], conditions, lockTime);
    var redeemScript = bitcoin.script.compile(decodedScript);
    
    var scriptPubKey = bitcoin.script.compile([bitcoin.opcodes.OP_HASH160, bitcoin.crypto.hash160(redeemScript), bitcoin.opcodes.OP_EQUAL]); //bitcoin.script.scriptHash.output.encode
    var address = bitcoin.address.fromOutputScript(scriptPubKey, network);
    console.log("P2SH address = " + address);
    instance.address = address;
    instance.enableLocks(address, lockTime, redeemScript);
}

// Locks down the contracts it encompasses from changes
ConditionalEscrowAddress.prototype.enableLocks = function (address, lockTime, redeemScript) {
    this.contracts.forEach(function (contract) {
        utils.writeProtected(contract, 'contractAddress', address);
        utils.writeProtected(contract, 'lockTime', lockTime);
        utils.writeProtected(contract, 'redeemScript', redeemScript);
        utils.writeProtected(contract, 'lock', true);
    });
    console.log('Contracts locked down... prepare and submit them');
};

module.exports = ConditionalEscrowAddress;
