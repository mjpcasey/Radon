/*!
 * Module dependencies.
 */

var SchemaType = require('../SchemaType');

/**
 * Boolean SchemaType constructor.
 *
 * @param {String} path
 * @param {Object} options
 * @inherits SchemaType
 * @api private
 */

function SchemaBoolean (path, options) {
  SchemaType.call(this, path, options, 'Boolean');
};

/*!
 * Inherits from SchemaType.
 */
SchemaBoolean.prototype.__proto__ = SchemaType.prototype;
SchemaBoolean.prototype.formatFun = function (val) {
  return !!val;
};

module.exports = SchemaBoolean;