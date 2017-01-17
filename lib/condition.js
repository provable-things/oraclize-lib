var utils = require('./utils');

function Condition(options) {
    utils.newInstanceCheck(this, Condition);
    utils.optionsCheck(options);

    this.output = {};

    try {
        this.datasource = options.datasource;
        this.query = options.query;
    } catch (e) {
        throw new Error(e);
    }
    this.checkOp = options.checkOp || 'tautology';
    this.value = options.value || null;
    this.proof = options.proof || Condition.proofType.None;
}

Condition.proofType = {};
Condition.proofType.None = 0x00;
Condition.proofType.TLSNotary = 0x10;

Condition.proofStorage = {};
Condition.proofStorage.IPFS = 0x01;

Condition.datasources = [
    'URL',
    'IPFS',
    'swarm',
    'WolframAlpha',
    'blockchain',
    'computation',
    'decrypt',
    'ethNnode',
    'nested'
];

Condition.ops = [
    '==',
    'eq',
    'checkValue',
    '!=',
    'ne',
    '!checkValue',
    '>',
    'gt',
    'greaterThan',
    '<',
    'lt',
    'lessThan',
    'true',
    'tautology',
    'false',
    'falsum',
    'contradiction',
    'contains',
    '!contains',
    'regex',
    'regexMatch'
];

Condition.mandatory = ['datasource', 'result'];

Condition.optional = ['checkOp', 'value', 'proof'];

Condition.prototype = {
    constructor: Condition,
    get oracle() {
        return '[' + this.datasource + '] ' + this.query;
    },
    set oracle(options) {
        if (typeof options !== 'undefined') {
            if (options instanceof Array) {
                this.datasource = options[0];
                this.query = options[1];
            } else if (typeof options === 'string') {
                var argSplit = options.indexOf(']') + 1;
                var parsedDatasource = options.substring(0, argSplit);
                this.datasource = parsedDatasource.match(/[\w*]+/)[0];
                var parsedQuery = options.substring(argSplit).trim();
                if (isJson(parsedQuery))
                    this.query = JSON.parse(parsedQuery);
                else
                    this.query = parsedQuery;

                }
            else if (typeof options === 'object') {
                this.datasource = options.datasource;
                this.query = options.query;
            }
        }
    },
    get conditional() {
        return 'if queried_result ' + this.output.check_op + ' ' + this.output.value;
    },
    set conditional(options) {
        this.checkOp = options.checkOp;
        this.value = options.value;
    },
    get datasource() {
        return this.output.datasource;
    },
    set datasource(val) {
        var dsSearch = new RegExp(val, 'i');
        var val = Condition.datasources.find(utils.getFormattedMatch.bind(this, dsSearch));
        if (typeof val === 'undefined')
            throw new Error('Invalid datasource specified. Should take one of the following forms: ' + Condition.datasources.toString());

        if (val === 'ethNode')
            val = utils.toSnakeCase(val, 'g');

        utils.writeProtected(this, ['output', 'datasource'], val);
    },
    get query() {
        return this.output.query;
    },
    set query(val) {
        utils.writeProtected(this, ['output', 'query'], val);
    },
    get checkOp() {
        return this.output.check_op;
    },
    set checkOp(val) {
        val = sanitizeOp(val);

        var opsDict = {
            '==': 'check_value',
            'eq': 'check_value',
            '!=': '!check_value',
            'ne': '!check_value',
            'regex': 'regex_match',
            '>': 'greater_than',
            'gt': 'greater_than',
            '<': 'less_than',
            'lt': 'less_than'
        };

        if (val in opsDict)
            val = opsDict[val];

        val = utils.toSnakeCase(val, 'g');
        utils.writeProtected(this, ['output', 'check_op'], val);
    },
    get value() {
        return this.output.value;
    },
    set value(val) {
        // #TODO could add check here on type depending upon checkOp
        utils.writeProtected(this, ['output', 'value'], val);
    },
    get proof() {
        return this.output.proof_type;
    },
    set proof(val) {
        var proof;
        if (val instanceof Array) {
            proof = 0;
            val.forEach(function (elem) {
                proof |= elem;
            });
        } else {
            proof = val;
        }
        utils.writeProtected(this, ['output', 'proof_type'], proof);
    }
};

function sanitizeOp(op) {
    if (Condition.ops.indexOf(op) !== -1)
        return op;
    else
        return 'tautology';
    }

function isJson(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

module.exports = Condition;
