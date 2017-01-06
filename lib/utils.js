var _get = require('lodash.get');
var traverse = require('traverse');

module.exports = {
    getFormattedMatch: function (regex, elem) {
        return elem.search(regex) !== -1;
    },
    toSnakeCase: function (str, flag) {
        var firstCapital = /[A-Z]/.test(str[0]);
        var regex = new RegExp((/[A-Z]+/).source, flag);

        return str.replace(regex, function (x) {
            if (firstCapital) {
                firstCapital = false;
                return x.toLowerCase()
            }
            return '_' + x.toLowerCase();
        });
    },
    newInstanceCheck: function (self, name) {
        if (!(self instanceof name))
            throw new Error('Must instantiate object with "new" keyword');
    },
    optionsCheck: function (opts) {
        if (typeof opts !== 'object')
            throw new Error('Required parameters object is missing. Refer to the mandatoryArgs variable for this type.');
    },
    writeProtected: function (pObj, path, val) {
        var key = path.pop();
        var obj;
        var oldKeyVal;

        if (path.length > 0)
            obj = _get(pObj, path);
        else
            obj = pObj;

        if (obj === pObj && key === 'lock')
            oldKeyVal = obj[key];

        writeUnprotect(pObj, obj, key);

        Object.defineProperty(obj, key, {
            configurable: true,
            enumerable: true,
            writable: false,
            value: val
        });

        if (obj === pObj && key === 'lock') {
            if (val === true && val !== oldKeyVal)
                Object.lockAllExisting(pObj, true);
            else if (val === false && val !== oldKeyVal)
                Object.lockAllExisting(pObj, false);
        }
    },
    getUnixTime: function (date) {
        return date.getTime() / 1000 | 0;
    },
    isHexString: function (inputString) {
        if (typeof inputString !== 'string')
            return false;

        var regex = /^(0x)?([A-Fa-f0-9]{2}){1,}$/g;
        return regex.test(inputString);
    },
    mergeObjects: function () {
        var resObj = {};
        for (var i = 0; i < arguments.length; i += 1) {
            var obj = arguments[i],
                keys = Object.keys(obj);
            for (var j = 0; j < keys.length; j += 1) {
                resObj[keys[j]] = obj[keys[j]];
            }
        }
        return resObj;
    }
};

function writeUnprotect(pObj, obj, key) {
    if (key !== 'lock' && pObj.lock === true) {
        if (obj.constructor.name === 'Contract')
            throw new Error('This contract is locked! ' + key);
        throw new Error('This object\'s properties are locked!');
    }

    Object.defineProperty(obj, key, {
        configurable: true,
        writable: true
    });
}

// takes about 9ms, must inspect performance on browser
Object.lockAllExisting = function(o, lock) {
    for (var path of traverse(o).paths()) {
        var key = path.pop();
        var obj;

        if (path.length > 0)
            obj = _get(o, path);
        else
            obj = o;

        var desc = Object.getOwnPropertyDescriptor(obj, key);

        if (!desc)
            continue;
        if ('value' in desc) {
            try {
                Object.defineProperty(obj, key, {configurable: true, writable: lock});
            }
            catch (e) {
                // can't change non-configurable types...
                //console.log(e);
            }
        }
    }
    return o;
};
