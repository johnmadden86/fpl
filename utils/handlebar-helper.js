/** @format */

const Handlebars = require('handlebars');

Handlebars.registerHelper('blankIfZero', number => (number !== 0 ? `(${number})` : ''));

Handlebars.registerHelper('noZero', number => (number === 0 ? 1 : number));

Handlebars.registerHelper('numberToPosition', number => {
  const positions = ['GK', 'DF', 'MF', 'FW'];
  return positions[number - 1];
});

Handlebars.registerHelper('readableChip', chip => {
  switch (chip) {
    case 'wildcard':
      return 'Wildcard';
    case 'freehit':
      return 'Free Hit';
    case '3xc':
      return 'Triple Captain';
    case 'bboost':
      return 'Bench Boost';
    default:
      return null;
  }
});

module.exports = Handlebars;
