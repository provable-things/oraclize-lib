var assert = require('assert');
var request = require('request');
var stringify = require('json-stable-stringify');
var bitcoin = require('bitcoinjs-lib');
var typeforce = require('typeforce');
var utils = require('../../utils');

//TODO Decide if internal variables should refer as escrow or contract

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


function getScript(ORACLIZE, ALICE, BOB, conditions, lockTime, metadata) {
    var script = [];
    if (metadata !== null) {
        Array.prototype.push.apply(script, [
            metadata,
            bitcoin.opcodes.OP_DROP
        ]);
    }
    if ((lockTime != null) && (lockTime['signer'] != null) && (lockTime['ts'] != null)) {
        Array.prototype.push.apply(script, [
            bitcoin.opcodes.OP_DEPTH,
            bitcoin.opcodes.OP_1SUB,
            bitcoin.opcodes.OP_0NOTEQUAL,
            bitcoin.opcodes.OP_NOTIF, // 1 elements on the stack, lockTime based spending?
            lockTime['signer'].getPublicKeyBuffer(),
            bitcoin.opcodes.OP_CHECKSIGVERIFY, // signer has signed the whole script
            bitcoin.script.number.encode(lockTime['ts']),
            bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY, // but it is too early? fail!
            bitcoin.opcodes.OP_DROP,
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
        bitcoin.opcodes.OP_TRUE,
        bitcoin.opcodes.OP_ELSE, // well, maybe this wasn't Alice then?
        bitcoin.opcodes.OP_DROP,
        bitcoin.opcodes.OP_FALSE
    ]);
    for (var j = 0; j < conditions.length; j++) {
        Array.prototype.push.apply(script, [
            bitcoin.opcodes.OP_DUP,
            bitcoin.opcodes.OP_NOTIF,
              bitcoin.opcodes.OP_DROP,
              bitcoin.opcodes.OP_FROMALTSTACK,
              bitcoin.opcodes.OP_FROMALTSTACK,
              bitcoin.opcodes.OP_2DUP, //
              bitcoin.opcodes.OP_TOALTSTACK, //
              bitcoin.opcodes.OP_TOALTSTACK, //
              bitcoin.opcodes.OP_CODESEPARATOR,
              conditions[j]['hash'],
              bitcoin.opcodes.OP_DROP,
              conditions[j]['pubkey'],
              bitcoin.opcodes.OP_CHECKSIG,
              bitcoin.opcodes.OP_IF,
                ORACLIZE.getPublicKeyBuffer(),
                bitcoin.opcodes.OP_CHECKSIGVERIFY,
                bitcoin.opcodes.OP_TRUE,
              bitcoin.opcodes.OP_ELSE,
                bitcoin.opcodes.OP_DROP, //remove 2nd sig from stack
                bitcoin.opcodes.OP_FALSE,
              bitcoin.opcodes.OP_ENDIF,
            bitcoin.opcodes.OP_ENDIF
        ]);
    }
    Array.prototype.push.apply(script, [bitcoin.opcodes.OP_ENDIF, bitcoin.opcodes.OP_ENDIF]);
    return script;
}

var network = bitcoin.networks.testnet
var pubKey = new Buffer('038ea27103fb646a2cea9eca9080737e0b23640caaaef2853416c9b286b353313e', 'hex');
var ORACLIZE = bitcoin.ECPair.fromPublicKeyBuffer(pubKey, network);

function ConditionalEscrowAddress(options, cb) {
    utils.newInstanceCheck(this, ConditionalEscrowAddress);
    var hashType = bitcoin.Transaction.SIGHASH_ALL;
    var conditionMarkers = new Array;
    this.contracts = options.contracts;
    this.keys = options.keys;
    this.lockTime = options.lockTime || null;
    this.metadata = options.metadata || null;
    if (this.metadata !== null) {
        if (utils.isHexString(this.metadata))
            this.metadata = new Buffer(this.metadata.replace('0x', ''), 'hex');
        else
            throw new Error('Metadata argument provided is not a valid hex-string type.')
    }
    var self = this;
    var ctr = 0;
    this.contracts.forEach(function (contract, index, array) {
        contract.object.getDryMarker(function (thisContract, subcontract) {
            // verify it's a valid bitcoinContract
            if (!contract.object.isBitcoinSpecial)
                throw new Error('Contract at index ' + index + ' is not of the required bitcoin contract type');

            var subcontractStable = stringify(subcontract);
            var marker = bitcoin.crypto.sha256(subcontractStable);

            // add pertinent infos to contract object
            utils.writeProtected(contract.object, ['id'], index);
            utils.writeProtected(contract.object, ['marker'], marker);
            utils.writeProtected(contract.object, ['cosigner'], contract.cosigner.getAddress());
            ctr++;

            conditionMarkers.push({ hash: marker, pubkey: contract.cosigner.getPublicKeyBuffer() });
            if (ctr === array.length) {
                setAddress(self, conditionMarkers);
                cb();
            }
        });
    });
}

function setAddress(instance, conditions) {
    var keys = instance.keys;
    var lockTime = instance.lockTime;
    var decodedScript = getScript(ORACLIZE, keys[0], keys[1], conditions, lockTime, instance.metadata);
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
        contract = contract.object;
        utils.writeProtected(contract, ['escrowAddress'], address);
        utils.writeProtected(contract, ['lockTime'], lockTime);
        utils.writeProtected(contract, ['redeemScript'], redeemScript);
        utils.writeProtected(contract, ['lock'], true);
    });
    // lock self after locking contracts down
    //utils.writeProtected(this, ['lock'], true);
    console.log('Contracts locked down... prepare and submit them');
};

module.exports = ConditionalEscrowAddress;
