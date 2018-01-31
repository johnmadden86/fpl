'use strict';

const Handlebars = require('handlebars');
const logger = require('./logger');

Handlebars.registerHelper('blankIfZero', function (number) {
  if (number !== 0) {
    return '(' + number + ')';
  }
});

Handlebars.registerHelper('noZero', function (number) {
  return number === 0 ? 1 : number;
});

Handlebars.registerHelper('numberToPosition', function (number) {
  const positions = ['GK', 'DF', 'MF', 'FW'];
  return positions[number - 1];
});

Handlebars.registerHelper('readableChip', function (chip) {
  switch (chip) {
    case 'wildcard':
      return 'Wildcard';
      break;
    case 'freehit':
      return 'Free Hit';
      break;
    case '3xc':
      return 'Triple Captain';
      break;
    case 'bboost':
      return 'Bench Boost';
      break;
  }
});

module.exports = Handlebars;