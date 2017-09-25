'use strict';
const request = require('request');
const logger = require('../utils/logger');
const fplUrl = 'https://fantasy.premierleague.com/drf/';
let gameDetails;
const players = [];
const tables = [];
let requestOptions = {
  url: fplUrl,
  method: 'GET',
  json: {},
};

const fpl = {

  /*
  getLiveData(player, footballer, match) {
    requestOptions.url = fplUrl + 'event/' + gameDetails.thisGameWeek + '/live';
    request(requestOptions, async (error, response, body) => {
    });
  },
  */

  getGameDetails() {
    requestOptions.url = fplUrl + 'bootstrap-static';
    request(requestOptions, async (error, response, body) => {
      gameDetails = await {
        thisGameWeek: body['current-event'],
        nextGameWeek: body['next-event'],
        months: body.phases,
      };
      gameDetails.nextDeadline = body.events[gameDetails.nextGameWeek].deadline_time;

      gameDetails.months.forEach((month) => {
        delete month.id;
      });

      gameDetails.months.shift();
      if (gameDetails.thisGameWeek < 38) {
        gameDetails.nextDeadline = body.events[gameDetails.thisGameWeek].deadline_time;
      }

      let i = 0;
      let currentMonth;
      while (i < 10) {
        if (gameDetails.thisGameWeek >= gameDetails.months[i].start_event &&
            gameDetails.thisGameWeek <= gameDetails.months[i].stop_event) {
          currentMonth = gameDetails.months[i].name;
        }

        i++;
      }

      gameDetails.currentMonth = currentMonth;
      logger.debug('Got game details ' + new Date());
      fpl.getLeagueDetails(6085);
    });
  },

  getLeagueDetails(leagueId) {
    requestOptions.url = fplUrl + 'leagues-classic-standings/' + leagueId;
    request(requestOptions, async (err, response, body) => {
      const results = await body.standings.results;
      for (let result of results) {
        const player = {
          teamId: result.entry,
          playerName: result.player_name,
          teamName: result.entry_name,
          weekScores: [],
        };

        players.push(player);
      }

      logger.debug(players.length + ' players got ' + new Date());
      let counter = [];
      players.forEach((player) => {
        fpl.getPlayerScores(player, counter);
      });
    });
  },

  getPlayerScores(player, counter) {
    let i = 1;
    while (i < gameDetails.nextGameWeek) {
      requestOptions.url = fplUrl + 'entry/' + player.teamId + '/event/' + i + '/picks';
      request(requestOptions, async (err, response, body) => {
        const details = await body.entry_history;
        const weekScore = {
          gameWeek: details.event,
          points: details.points,
          transfers: details.event_transfers,
          transferCost: details.event_transfers_cost,
        };
        weekScore.netScore = weekScore.points - weekScore.transferCost;
        player.weekScores.push(weekScore);
        if (player.weekScores.length === gameDetails.thisGameWeek) {
          player.weekScores.sort((a, b) => {
            let gwA = a.gameWeek;
            let gwB = b.gameWeek;
            return gwA - gwB;
          });
          logger.debug('got scores for ' + player.playerName + ' ' + new Date());
          fpl.getMonthScores(player, counter);
        }
      });

      i++;
    }

  },

  getMonthScores(player, counter) {
    let i = 0;
    let j = 0;
    let points = 0;
    let monthScore = new Map();
    while (i < gameDetails.thisGameWeek) {
      let k = i + 1;
      if (k >= gameDetails.months[j].start_event &&
          k <= gameDetails.months[j].stop_event) {
        points = 0;
        j++;
      }

      points += player.weekScores[i].netScore;
      monthScore.set(gameDetails.months[j - 1].name, points);
      i++;
    }

    logger.debug('got month scores for ' + player.playerName + ' ' + new Date());

    player.monthScores = monthScore;
    counter.push(player.teamId);
    fpl.createTables(counter);
  },

  createTables(counter) {
    if (counter.length === players.length) {
      logger.debug('Creating tables');
      let i = 0;
      while (i < gameDetails.months.length) {
        const table = {
          month: gameDetails.months[i].name,
          content: fpl.createTable(gameDetails.months[i].name),
          prize: 5 * (gameDetails.months[i].stop_event - gameDetails.months[i].start_event + 1),
        };
        tables.push(table);
        if (table.month === gameDetails.currentMonth) {
          break;
        }

        i++;
      }
    }
  },

  createTable(month) {
    const table = [];
    players.forEach((player) => {
      const entry = {
        name: player.playerName,
        score: player.monthScores.get(month),
      };
      table.push(entry);
    });

    table.sort((a, b) => {
      let scoreA = a.score;
      let scoreB = b.score;
      return scoreB - scoreA;
    });
    logger.debug('table created for ' + month + ' ' + new Date());
    return table;
  },

  index(request, response) {
    const viewData = {
      title: 'Welcome',
      players: players,
      gameDetails: gameDetails,
      tables: tables,
    };
    logger.info('Rendering index');
    response.render('index', viewData);
  },

};

module.exports = fpl;
