'use strict';

const Handlebars = require('handlebars');
const logger = require('./logger');

Handlebars.registerHelper('blankIfZero', function (number) {
  if (number !== 0) {
    return '(' + number + ')';
  }
});

Handlebars.registerHelper('numberToPosition', function (number) {
  const positions = ['GK', 'DF', 'MF', 'FW'];
  return positions[number - 1];
});

module.exports = Handlebars;