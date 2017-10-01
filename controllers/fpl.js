'use strict';
const request = require('request');
const logger = require('../utils/logger');
const fplUrl = 'https://fantasy.premierleague.com/drf/';
const Handlebars = require('../utils/handlebar-helper');
let gameDetails;
let footballers = {};

const players = {};
let overallTable;
let tables = [];
const rounds = [];
const cupTables = [];
let time = new Date();
function timeToLoad() {
  let timeToLoad = new Date() - time;
  timeToLoad /= 1000;
  return 'in ' + timeToLoad + ' secs';
}

let counter = 0;

let loading = true;
let requestOptions = {
  url: fplUrl,
  method: 'GET',
  json: {},
};

const fpl = {

  createMatch(team1, team2, gameWeek) {
    return {
      team1: {
        id: team1.teamId,
        name: team1.playerName,
        score: team1.weekScores[gameWeek].netScore,
      },
      team2: {
        id: team1.teamId,
        name: team2.playerName,
        score: team2.weekScores[gameWeek].netScore,
      },
    };
  },

  getWinner(match) {
    if (match.team1.score > match.team2.score) {
      return match.team1.id;
    } else if (match.team1.score < match.team2.score) {
      return match.team2.id;
    } else {
      return 'Draw';
    }
  },

  makeDraw() {
    function find(teamId) {
      for (let i = 0; i < players.length; i++) {
        if (players[i].teamId === teamId) {
          return players[i];
        }
      }
    }

    // 240 80 80 50
    const cupWeeks = [0, 7, 14, 21, 29, 37];
    const superCup = fpl.createMatch(find(1940767), find(998490), cupWeeks[0]);
    logger.debug(superCup);
    const bye = find(1971796);
    const qualifierTeams = [
      119880,
      2089907,
      330128,
      1952631,
      1974840,
      18217,
      2849225,
      319619,
      4045,
      1660123,
    ];
    const qualifierMatches = [];
    let i = 0;
    while (i < 9) {
      let match = fpl.createMatch(find(qualifierTeams[i]), find(qualifierTeams[i + 1]), cupWeeks[0]);
      qualifierMatches.push(match);
      i = i + 2;
    }

    const eliteCup = [find(1940767), find(998490), bye];
    qualifierMatches.forEach(function (match) {
      eliteCup.push(find(fpl.getWinner(match)));
    });

    logger.debug(qualifierMatches);

    logger.debug(eliteCup.length);
    logger.debug(eliteCup[0]);
    logger.debug(eliteCup[1]);
    logger.debug(eliteCup[2]);

    /*
    Balotelli Tubbies 65-27 FC BrokeLads
    Savage Hurling Men 38-60 Some Side Salah
    You had me at Merlot 62-60 Liverpoo
    She's pukin' 43-53 Temp
    The Pintmen 68-51 UPURS

    Next round of cup action is week 8 (Oct 14)
    debug: Mark Nicholson - 18217
    debug: Sugar For My Honey - 1940767
    debug: John Madden - 330128
    debug: Martin Dunphy - 1974840
    debug: Conor Noonan - 4045
    debug: Patrick Butler - 1660123
    debug: Mark Cashin - 1971796
    debug: Matthew Gannon - 119880
    debug: Brian Doyle - 1952631
    debug: Richard O Shea - 998490
    debug: Darragh Murphy - 2089907
    debug: jimmy murphy - 2849225
    debug: Paraic O'Keeffe - 319619
    */
  },

  getGameDetails() {
    requestOptions.url = fplUrl + 'bootstrap-static';
    request(requestOptions, async (error, response, body) => {
      gameDetails = await {
        thisGameWeek: body['current-event'],
        nextGameWeek: body['next-event'],
        months: body.phases,
      };
      if (gameDetails.thisGameWeek < 38) {
        gameDetails.nextDeadline = body.events[gameDetails.thisGameWeek].deadline_time;
      }

      gameDetails.months.forEach((month) => {
        delete month.id;
      });
      let i = 1;
      let currentMonth;
      while (i < 10) {
        if (gameDetails.thisGameWeek >= gameDetails.months[i].start_event &&
            gameDetails.thisGameWeek <= gameDetails.months[i].stop_event) {
          currentMonth = gameDetails.months[i].name;
        }

        i++;
      }

      gameDetails.currentMonth = currentMonth;

      body.elements.forEach(function (element) {
        footballers[element.id] = element;//element_type=position
      });

      logger.debug('Got game details ' + timeToLoad());
      fpl.getPlayers(6085);
    });
  },

  getPlayers(leagueId) {
    requestOptions.url = fplUrl + 'leagues-classic-standings/' + leagueId;
    request(requestOptions, async (err, response, body) => {
      const results = await body.standings.results;
      for (let result of results) {
        players[result.entry] = result;
        players[result.entry].liveWeekTotal = 0;
        fpl.getScores(players[result.entry]);
        fpl.getTeams(players[result.entry]);
      }

      logger.debug(results.length + ' players got ' + timeToLoad());
    });
  },

  getScores(player) {
    requestOptions.url = fplUrl + 'entry/' + player.entry + '/history';
    request(requestOptions, async (err, response, body) => {
      const details = await body.history;
      let weekScores = {};
      details.forEach(function (gameWeek) {
        weekScores[gameWeek.event] = gameWeek;
        weekScores[gameWeek.event].netScore = weekScores[gameWeek.event].points - weekScores[gameWeek.event].event_transfers_cost;
      });

      player.weekScores = weekScores;
      logger.debug('got scores for ' + player.player_name + ' ' + timeToLoad());
      fpl.getMonthScores(player);
    });
  },

  getMonthScores(player) {
    let points = 0;
    let monthScore = {};
    let i = 1;
    let j = 1;
    while (i < gameDetails.nextGameWeek) {
      if (i >= gameDetails.months[j].start_event && i <= gameDetails.months[j].stop_event) {
        points = 0;
        j++;
      }

      points += player.weekScores[i].netScore;
      monthScore[gameDetails.months[j - 1].name] = points;
      i++;
    }

    logger.debug('got month scores for ' + player.player_name + ' ' + timeToLoad());

    player.monthScores = monthScore;
    counter++;
    if (counter === Object.keys(players).length) {
      tables = [];
      fpl.createTables();
      fpl.overallTable();
      counter = 0;
    }
  },

  createTables() {
    logger.debug('Creating tables');
    let i = 1;
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
  },

  overallTable() {
    let table = [];
    Object.keys(players).forEach(function (player) {
      const entry = {
        name: players[player].player_name,
      };

      let score = 0;
      Object.keys(players[player].weekScores).forEach(function (weekScore) {
        score += players[player].weekScores[weekScore].netScore;
      });

      entry.score = score;
      table.push(entry);
    });

    table.sort((a, b) => {
      let scoreA = a.score;
      let scoreB = b.score;
      return scoreB - scoreA;
    });

    table[0].prize = '€240';
    table[1].prize = '€80';

    overallTable = table;
    logger.debug('Overall table created' + timeToLoad());
  },

  createTable(month) {
    const table = [];
    Object.keys(players).forEach((player) => {
      const entry = {
        name: players[player].player_name,
        score: players[player].monthScores[month],
      };
      table.push(entry);
    });

    table.sort((a, b) => {
      let scoreA = a.score;
      let scoreB = b.score;
      return scoreB - scoreA;
    });
    logger.debug('table created for ' + month + ' ' + timeToLoad());
    return table;
  },

  getTeams(player) {
    requestOptions.url = fplUrl + 'entry/' + player.entry + '/event/' + gameDetails.thisGameWeek + '/picks';
    request(requestOptions, async (err, response, body) => {
      const picks = await body.picks;
      let team = [];
      let i = 0;
      while (i < picks.length) {
        picks[i].name = footballers[picks[i].element].web_name;
        picks[i].playingPosition = footballers[picks[i].element].element_type;
        team.push(picks[i]);
        i++;
      }

      let df = 0;
      let mf = 0;
      let fw = 0;
      let j = 1;
      while (team[j].playingPosition === 2) {
        df++;
        j++;
      }

      while (team[j].playingPosition === 3) {
        mf++;
        j++;
      }

      while (team[j].playingPosition === 4) {
        fw++;
        j++;
      }

      player.formation = df + '-' + mf + '-' + fw;

      const transferDetails = await {
        chip: body.active_chip,
        transfers: body.entry_history.event_transfers,
        pointsHit: body.entry_history.event_transfers_cost * -1,
      };

      team.forEach(function (footballer) {
        fpl.getLiveScores(player, footballer);
      });

      player.team = team;
      player.transferDetails = transferDetails;
    });
  },

  getLiveScores(player, footballer) {
    requestOptions.url = fplUrl + 'element-summary/' + footballer.element;
    request(requestOptions, async (err, response, body) => {
      const scoreTypes = await body.explain['0'].explain;
      let points = 0;
      let i = 0;
      while (i < Object.keys(scoreTypes).length) {
        let key = Object.keys(scoreTypes)[i];
        points += scoreTypes[key].points;
        i++;
      }

      if (body.explain['0'].fixture.stats.length > 0) {

        const bpsAway = body.explain['0'].fixture.stats[9].bps.a;
        const bpsHome = body.explain['0'].fixture.stats[9].bps.h;
        const bps = bpsAway.concat(bpsHome);
        bps.sort(function (a, b) {
          return b.value - a.value;
        });

        let threeBonusCount = 0;
        let twoBonusCount = 0;
        let oneBonusCount = 0;
        let i = 0;
        while (bps[0].value === bps[i].value) {
          threeBonusCount++;
          i++;
        }

        while (threeBonusCount === 1 && bps[threeBonusCount].value === bps[i].value) {
          twoBonusCount++;
          i++;
        }

        while (threeBonusCount + twoBonusCount === 2 && bps[threeBonusCount + twoBonusCount].value === bps[i].value) {
          oneBonusCount++;
          i++;
        }

        let bonus = 0;
        let j = 0;
        while (j < threeBonusCount) {
          if (bps[j].element === footballer.element) {
            bonus = 3;
          }

          j++;
          while (j < threeBonusCount + twoBonusCount) {
            if (bps[j].element === footballer.element) {
              bonus = 2;
            }

            j++;
            while (j < threeBonusCount + twoBonusCount + oneBonusCount) {
              if (bps[j].element === footballer.element) {
                bonus = 1;
              }

              j++;
            }
          }
        }

        if (!scoreTypes.bonus) {
          points += bonus;
        }

        points *= footballer.multiplier;
        if (footballer.position <= 11) {
          player.liveWeekTotal += points;
        }

        if (body.explain['0'].explain.minutes.value === 0 && body.explain['0'].fixture.started === true) {
          points = '-';
        }

        footballer.liveScore = points;
      }
    });
  },

  index(request, response) {
    const viewData = {
      title: 'Welcome',
      players: players,
      gameDetails: gameDetails,
      tables: tables,
      loading: loading,
      overallTable: overallTable,
    };
    logger.info('Rendering index ' + timeToLoad());
    response.render('index', viewData);
  },

};

module.exports = fpl;
