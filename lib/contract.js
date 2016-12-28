var request = require('request');
var utils = require('./utils');
// #FIXME make proper lock mechanism...

var MONTH = 60 * 60 * 24 * 30;

function Contract(options) {
    utils.newInstanceCheck(this, Contract);

    if (typeof options === 'undefined')
        throw new Error('Required parameters missing. Specify either an object containing daterange or the date marker for execution to start.');

    this.output = {};

    if (options.helperConstructor === true)
        return;

    if (typeof options === 'string') {
        var args = '/status?_fields=daterange,interval,actions,payload';
        getContractById(this, options, args, setContract);
        return;
    }

    //MANDATORY, at least t0
    this.daterange = options.daterange || options;
    this.interval = options.interval || 3600;

}

Contract.prototype = {
    constructor: Contract,
    get daterange() {
        return this.output.daterange;
    },
    set daterange(val) {
        // #TODO check if valid daterange
        var singleElement = false;
        if (!(val instanceof Array))
            singleElement = true;
        else if (val.length === 1){
            singleElement = true;
            val = val[0];
        }

        // val is assumed to be unix timestamp in seconds here!
        if (singleElement) {
            if (isNaN(val))
                throw new Error('Input for daterange must either be a number, or an array containing two numbers.')

            val = [
                val, val + 2 * MONTH
            ];
            console.log('warn: T1 marker not entered, calculated T1 marker as T0 + 2 months. Reformatted input to: ' + val.toString());
        }

        if (val[0] > utils.getUnixTime(new Date) + 6 * MONTH)
            throw new Error('Initial daterange element must begin within 6 months.');

        this.output.daterange = val;
        utils.writeProtected(this.output, 'daterange', val);
    },
    get interval() {
        return this.output.interval;
    },
    set interval(val) {
        // #TODO santizie based on type specified
        utils.writeProtected(this.output, 'interval', val);
    }
};

Contract.prototype.setFrequency = function (frequency) {
    this.interval = frequency;
};

Contract.prototype.applyConditions = function (conditions) {
    if (conditions instanceof Array) {
        if (conditions.length % 2 === 0)
            throw new Error('Invalid number of arguments. Multiple conditions must be separated by "and" / "or" operators');

        for (var i = 0; i < conditions.length; i++) {
            if (i % 2 === 0 && conditions[i].constructor.name !== 'Condition')
                throw new Error('Invalid input. Must pass valid oraclize Condition object(s).');
            else if (i % 2 === 1 && conditions[i] !== 'and' && conditions[i] !== 'or')
                throw new Error('Multiple conditions must be separated by "and" / "or" operators');
            else if (i % 2 === 0)
                conditions[i] = conditions[i].output;
            }
        } else {
        if (conditions.constructor.name !== 'Condition')
            throw new Error('Invalid input. Must pass valid oraclize Conditions object.');

        conditions = [conditions.output];
    }
    utils.writeProtected(this.output, 'conditions', conditions);
}

Contract.prototype.clearConditions = function (index) {
    if (typeof index === 'undefined')
        delete this.output.conditions;
    else
        this.output.conditions.splice(index, 1);
    }
;

Contract.prototype.applyActions = function (actions) {
    if (!(actions instanceof Array))
        actions = [actions];

    utils.writeProtected(this.output, 'actions', actions);

    this.output.actions = actions;
};

Contract.prototype.clearActions = function (index) {
    if (typeof index === 'undefined')
        delete this.output.actions;
    else
        this.output.actions.splice(index, 1);
    }
;

Contract.prototype.submit = function () {
    var conditions = this.output.conditions;
    if (typeof conditions === 'undefined' || conditions.length === 0)
        throw new Error('At least one condition must be applied to the contract');
    if (this.submitted)
        throw new Error('This contract has already been submitted... please check the oraclize id.')

    submitOraclizeContract(this, '', setOraclizeId);

    // enabled submitted flag to avoid resubmission
    utils.writeProtected(this, 'submitted', true);
    // enable lock flag for integrity of the object
    utils.writeProtected(this, 'lock', true);
}

Contract.prototype.getDryMarker = function (callback) {
    var conditions = this.output.conditions;
    if (typeof conditions === 'undefined' || conditions.length === 0)
        throw new Error('At least one condition must be applied to the contract');

    var marker = '?dry=true&_fields=daterange,interval,version,payload,!result';
    submitOraclizeContract(this, marker, callback);
};

Contract.prototype.getStatus = function (remote, callback) {
    if (typeof this.oraclizeId === 'undefined')
        throw new Error('No id available yet... make sure this contract has been submitted!');

    if (remote === false)
        return this.status;

    utils.writeProtected(this, 'lock', false);

    var args = '/status?_fields=active,actions,checks';
    getContractById(this, this.oraclizeId, args, function (thisContract, parsed) {
        utils.writeProtected(thisContract, 'status', {});
        utils.writeProtected(thisContract.status, 'active', parsed.active);
        utils.writeProtected(thisContract.status, 'actions', parsed.actions);
        utils.writeProtected(thisContract.status, 'checks', parsed.checks);
        console.log(parsed);
        utils.writeProtected(thisContract, 'lock', true);

        if (typeof callback === 'function')
            callback(parsed);
        }
    );
};

function setOraclizeId(thisContract, parsedContract) {
    var id = parsedContract.id
    thisContract.oraclizeId = id;

    console.log(id);
}

function submitOraclizeContract(thisContract, extra, done) {
    var oraclizeContract = thisContract.output;
    var url = 'https://api.oraclize.it/v1/contract/create' + extra;
    request({
        method: 'POST',
        url: url,
        body: JSON.stringify(oraclizeContract)
    }, function (error, response, body) {
        if (error)
            throw new Error(error)

        var parsedContract = JSON.parse(body).result;
        done(thisContract, parsedContract);
    });
}

function getContractById(thisContract, contractId, extra, done) {
    var url = 'https://api.oraclize.it/v1/contract/' + contractId + extra;

    console.log('Fetching contract from Oraclize, please wait...');
    request(url, function (error, response, body) {
        if (error)
            throw new Error(error);

        var parsedContract = JSON.parse(body);
        if (!parsedContract.success)
            throw new Error('Invalid contract ID specified!');

        parsedContract = parsedContract.result;
        done(thisContract, parsedContract);
    });
}

function setContract(thisContract, parsedContract) {
    var out = thisContract.output;
    //#TODO See if additional checks are required, in case of null or empty actions
    utils.writeProtected(out, 'daterange', parsedContract.daterange);
    utils.writeProtected(out, 'interval', parsedContract.interval);
    utils.writeProtected(out, 'actions', parsedContract.actions);
    utils.writeProtected(out, 'conditions', parsedContract.payload.conditions);
    setOraclizeId(out, parsedContract);
    console.log('New contract created using fetched data');
}

module.exports = Contract;
