'use strict';

const express = require('express');
const logger = require('./utils/logger');
const bodyParser = require('body-parser');
const exphbs = require('express-handlebars');

const app = express();
//app.use(bodyParser.urlencoded({ extended: false }));
//app.use(express.static('public'));
app.engine('.hbs', exphbs({
  extname: '.hbs',
  defaultLayout: 'main'
}));
app.set('view engine', '.hbs');
const routes = require('./routes');
app.use('/', routes);
const fpl = require('./controllers/fpl');
const listener = app.listen(process.env.PORT || 4000, function () {
  logger.info('Your app is listening on port ' + listener.address().port);
  fpl.runApp();
});

