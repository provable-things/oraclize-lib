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
    writeProtected: function (obj, key, val) {
        writeUnprotect(obj, key);

        Object.defineProperty(obj, key, {
            configurable: true,
            enumerable: true,
            writable: false,
            value: val
        });
    },
    getUnixTime: function (date) {
        return date.getTime() / 1000 | 0;
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

function writeUnprotect(obj, key) {
    if (key !== 'lock' && obj.lock === true) {
        if (obj.constructor.name === 'Contract')
            throw new Error('This contract is locked! ' + key);
        throw new Error('This object\'s properties are locked!');
    }

    Object.defineProperty(obj, key, {
        configurable: true,
        writable: true
    });
}
