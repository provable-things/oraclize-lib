var utils = require('./lib/utils');

// use this for importing any helpers
var extraExports = {};
extraExports.AND = 'and';
extraExports.OR = 'or';

extraExports.helpers = {
    bitcoin: {
        Contract: require('./lib/helpers/bitcoin/contract'),
        ConditionalEscrowAddress: require('./lib/helpers/bitcoin/ConditionalEscrowAddress')
    }
};

module.exports = utils.mergeObjects({
    // base library
    Contract: require('./lib/contract'),
    Action: require('./lib/action'),
    Condition: require('./lib/condition')
}, extraExports);
