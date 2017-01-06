var utils = require('./utils');

function Action(options) {
    utils.newInstanceCheck(this, Action);
    utils.optionsCheck(options);

    this.output = {};

    try {
        this.type = options.type;
        this.args = options.args;
    } catch (e) {
        throw new Error(e);
    }
}

Action.prototype = {
    constructor: Action,
    get type() {
        return this.output.type;
    },
    set type(val) {
        // #TODO check if valid action type
        var valSearch = new RegExp(val, 'i');
        formattedVal = Action.types.find(utils.getFormattedMatch.bind(this, valSearch));
        val = utils.toSnakeCase(formattedVal);
        utils.writeProtected(this, ['output', 'type'], val);
    },
    get args() {
        return this.output.args;
    },
    set args(val) {
        utils.writeProtected(this, ['output', 'args'], val);
    }
};

// Warning ES-6 dependent
Action.prototype.addArg = function (arg) {
    // #TODO Potential check to make sure already set keys aren't being overwritten?
    if (typeof arg !== 'object')
        throw new Error('Argument passed must be an object!');

    utils.writeProtected(this, ['output', 'args'], utils.mergeObjects(this.output.args, arg))
};

Action.types = [
    'btcSignTransaction',
    'btcSendRawTransaction',
    'ethSignTransaction',
    'ethSendRawTransaction',
    'httpGet',
    'httpPost',
    'ipfsPush'
];

Action.mandatory = [
    'type',
    'args'
];

Action.future = {
    result: function (index) {
        index--;
        return '{actions:[' + index + ']::[result]}';
    }
};

module.exports = Action;
