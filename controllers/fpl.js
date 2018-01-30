'use strict';
const axios = require('axios');
const logger = require('../utils/logger');
const Handlebars = require('../utils/handlebar-helper');
const leagueCode = 6085;
let gameDetails;
let footballers = {};
const players = {};
let playersSorted;
let prizesSorted;
let overallTable;
let tables = [];
let time = new Date();
function timeToLoad() {
  let timeToLoad = new Date() - time;
  timeToLoad /= 1000;
  return ' in ' + timeToLoad + ' secs';
}

let cup;
let cupTables = [];
let liveScoreCounter;
let loading = true;
let request = axios.create({
  baseURL: 'https://fantasy.premierleague.com/drf/',
  method: 'GET',
});

let elements;
let fixtures;

const fpl = {

  runApp() {
    let attempt = 1;
    logger.info('Attempt ' + attempt);
    fpl.getGameDetails(attempt);
    function run() {
      attempt++;
      loading = true;
      logger.info('Attempt ' + attempt);
      time = new Date();
      fpl.getGameDetails(attempt);
    }

    setInterval(run, 1000 * 60 * 5);
  },

  getGameDetails(attempt) {
    liveScoreCounter = 0;
    request('bootstrap-static')
        .then(response => {
          const body = response.data;
          gameDetails = {
            thisGameWeek: body['current-event'],
            nextGameWeek: body['next-event'],
            months: body.phases,
          };

          if (gameDetails.thisGameWeek < 38) {
            gameDetails.nextDeadline = body.events[gameDetails.thisGameWeek].deadline_time;
          }

          gameDetails.thisGameWeekFinished = body.events[gameDetails.thisGameWeek - 1].finished;

          gameDetails.months.forEach((month) => {
            delete month.id;
          });
          let currentMonth;
          for (let i = 1; i < 10; i++) {
            if (gameDetails.thisGameWeek >= gameDetails.months[i].start_event &&
                gameDetails.thisGameWeek <= gameDetails.months[i].stop_event) {
              currentMonth = gameDetails.months[i].name;
            }
          }

          gameDetails.currentMonth = currentMonth;

          let footballersArray = [];

          body.elements.forEach(function (element, index, elements) {
            footballers[element.id] = element;
            if (Number(element.form) > 0) {
              footballersArray.push(element);
            }
          });

          logger.info('Got ' + Object.keys(footballers).length + ' footballers' + timeToLoad());
          logger.info('Getting stats for ' + footballersArray.length + ' footballers');
          logger.info('Got game details' + timeToLoad());
          fpl.live();

          if (attempt < 2) {
            setTimeout(() => {
              fpl.getStats(footballersArray);
            }, 3500);
          }
        })
        .catch(error => {
          logger.info(error);
        });
  },

  getStats(footballersArray) {
    let timeout = 0;
    let delay = footballersArray.length;
    footballersArray.forEach((footballer, index, footballers) => {
      setTimeout(() => {
        request('element-summary/' + footballer.id)
            .then(response => {
              const body = response.data;
              let total = 0;
              const power = 1 - 1 + gameDetails.thisGameWeek / 10;
              for (let i = 1; i <= gameDetails.thisGameWeek; i++) {
                total += Math.pow(i, power);
              }

              footballer.weightedCreativity = 0;
              footballer.weightedThreat = 0;
              body.history.forEach(event => {
                footballer.weightedCreativity += Number(event.creativity) * Math.pow(event.round, power) / total;
                footballer.weightedThreat += Number(event.threat) * Math.pow(event.round, power) / total;
              });
              logger.debug('got stats for ' + footballer.web_name + timeToLoad());
              footballer.rating =
                  (footballer.weightedThreat * (8 - footballer.element_type)
                      + footballer.weightedCreativity * 3); // (footballer.now_cost/10);
              delay--;
              if (delay === 0) {
                footballers.sort((a, b) => {
                  return b.rating - a.rating;
                });
                footballers.forEach(player => {
                  let position = '';
                  switch (player.element_type) {
                    case 1:
                      position = '\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tGK';
                      break;
                    case 2:
                      position = '\t\t\t\t\t\t\t\t\t\t\t\tDF';
                      break;
                    case 3:
                      position = '\t\t\t\t\t\tMF';
                      break;
                    case 4:
                      position = 'FW';
                      break;
                    default:
                      break;
                  }
                  if (player.element_type >= 3 && player.now_cost < 60) {
                    logger.info(position, player.web_name, Math.round(player.rating) / 10);
                  }
                });
              }
            })
            .catch(err => {
              logger.error('error retrieving stats for ' + footballer.web_name + '\n' + err);
            });
      }, timeout);
      timeout += 30;
    });
  },

  live() {
    request('event/' + gameDetails.thisGameWeek + '/live')
        .then(response => {
          const body = response.data;
          elements = body.elements;
          fixtures = body.fixtures;

          //setTimeout(() => {
          Object.keys(footballers).forEach(function (footballer) {
            if (elements[footballer] && elements[footballer].explain.length > 0) {
              let fixtureId = elements[footballer].explain[0][1];
              for (let i = 0; i < fixtures.length; i++) {
                if (fixtures[i].id === fixtureId) {
                  footballers[footballer].fixture = fixtures[i];
                  if (footballers[footballer].fixture.started) {
                    footballers[footballer].liveScore = elements[footballer].stats.total_points;
                    footballers[footballer].didNotPlay = elements[footballer].stats.minutes === 0;
                  }
                }
              }
            } else {
              footballers[footballer].didNotPlay = true;
            }
          });

          fixtures.forEach(function (fixture) {
            if (fixture.stats[8]) {
              if (fixture.stats[8].bonus.a.length + fixture.stats[8].bonus.h.length === 0) {
                fpl.getBonus(fixture);
                for (let i = 0; i < fixture.bonus.three.length; i++) {
                  fixture.bonus.three.forEach(function (element) {
                    footballers[element].liveScore += 3;
                  });
                }

                for (let i = 0; i < fixture.bonus.two.length; i++) {
                  fixture.bonus.two.forEach(function (element) {
                    footballers[element].liveScore += 2;
                  });
                }

                for (let i = 0; i < fixture.bonus.one.length; i++) {
                  fixture.bonus.one.forEach(function (element) {
                    footballers[element].liveScore += 1;
                  });
                }
              }
            }
          });

          fpl.getPlayers(leagueCode);
        });
    //}, 1500);
  },

  getBonus(fixture) {
    const three = [];
    const two = [];
    const one = [];
    if (fixture.stats.length > 0) {
      const bpsAway = fixture.stats[9].bps.a;
      const bpsHome = fixture.stats[9].bps.h;
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

      let j = 0;
      while (j < threeBonusCount) {
        three.push(bps[j].element);
        j++;
        while (j < threeBonusCount + twoBonusCount) {
          two.push(bps[j].element);
          j++;
          while (j < threeBonusCount + twoBonusCount + oneBonusCount) {
            one.push(bps[j].element);
            j++;
          }
        }
      }
    }

    fixture.bonus = {
      three: three,
      two: two,
      one: one,
    };
  },

  getPlayers(leagueId) {
    request('leagues-classic-standings/' + leagueId)
        .then(response => {
          const body = response.data;
          const results = body.standings.results;
          for (let result of results) {
            players[result.entry] = result;
            players[result.entry].prizeMoney = 0;
            players[result.entry].liveWeekTotal = 0;
            fpl.getTeams(players[result.entry]);
          }

          logger.info(results.length + ' players retrieved' + timeToLoad());
        });
  },

  getTeams(player) {
    request('entry/' + player.entry + '/event/' + gameDetails.thisGameWeek + '/picks')
        .then(response => {
          const body = response.data;
          const picks = body.picks;
          let team = [];

          for (let i = 0; i < picks.length; i++) {
            picks[i].name = footballers[picks[i].element].web_name;
            picks[i].image =
                'https://platform-static-files.s3.amazonaws.com/premierleague/photos/players/110x140/p'
                + footballers[picks[i].element].code + '.png';
            logger.info(typeof picks[i].image);
            picks[i].playingPosition = footballers[picks[i].element].element_type;
            picks[i].liveScore = footballers[picks[i].element].liveScore;
            picks[i].didNotPlay = footballers[picks[i].element].didNotPlay;
            if (picks[i].is_captain) {
              player.captain = picks[i].name;
              if (picks[i].didNotPlay) {
                player.useViceCaptain = true;
              }
            }

            team.push(picks[i]);
          }

          player.formation = fpl.getFormation(team);

          const transferDetails = {
            chip: body.active_chip,
            transfers: body.entry_history.event_transfers,
            pointsHit: body.entry_history.event_transfers_cost * -1,
          };

          player.team = team;
          player.transferDetails = transferDetails;
          if (player.formation !== null && transferDetails !== null) {
            logger.info('team details retrieved for ' + player.player_name + timeToLoad());
          } else {
            logger.error('error retrieving details  for ' + player.player_name + timeToLoad());
          }

          fpl.getTransfers(player);
        });
  },

  getFormation(team) {
    let gk = 0;
    let df = 0;
    let mf = 0;
    let fw = 0;
    let j = 0;
    while (team[j].playingPosition === 1) {
      gk++;
      j++;
    }

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

    return {
      g: gk,
      d: df,
      m: mf,
      f: fw,
    };
  },

  getTransfers(player) {
    request('entry/' + player.entry + '/transfers').then(response => {
      const body = response.data;
      let numberOfTransfers = 0;
      const transferHistory = body.history;
      transferHistory.forEach(function (transfer) {
        transfer.playerIn = footballers[transfer.element_in].web_name;
        transfer.playerOut = footballers[transfer.element_out].web_name;
        if (transfer.event === gameDetails.thisGameWeek) {
          transfer.latest = true;
          numberOfTransfers++;
        }
      });

      player.transferDetails.transfers = numberOfTransfers;
      player.transferHistory = transferHistory;
      logger.info('transfer info retrieved for ' + player.player_name + timeToLoad());
      fpl.getScores(player);
    });
  },

  getScores(player) {
    request('entry/' + player.entry + '/history').then(response => {
      const body = response.data;
      const totalTransfers = body.entry.total_transfers;
      const details = body.history;
      let weekScores = {};
      details.forEach(function (gameWeek) {
        weekScores[gameWeek.event] = gameWeek;
        weekScores[gameWeek.event].netScore =
            weekScores[gameWeek.event].points - weekScores[gameWeek.event].event_transfers_cost;
      });

      player.transferDetails.totalTransfers = totalTransfers;
      player.weekScores = weekScores;
      logger.info('retrieved scores for ' + player.player_name + timeToLoad());
      player.subsOut = [];

      for (let i = 0; i < player.team.length; i++) {
        fpl.getLiveScores(player, player.team[i]);
      }
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

    logger.info('retrieved month scores for ' + player.player_name + timeToLoad());
    player.monthScores = monthScore;
  },

  getLiveScores(player, footballer) {

    let formation = player.formation;

    function validFormation() {
      const eleven = formation.g + formation.d + formation.m + formation.f === 11;
      const positions = formation.g === 1 && formation.d >= 3 && formation.f >= 1;
      return eleven && positions;
    }

    function checkSub(footballerOut, footballerIn) {
      switch (footballerOut.playingPosition) {
        case 1:
          formation.g--;
          break;
        case 2:
          formation.d--;
          break;
        case 3:
          formation.m--;
          break;
        case 4:
          formation.f--;
          break;
      }

      switch (footballerIn.playingPosition) {
        case 1:
          formation.g++;
          break;
        case 2:
          formation.d++;
          break;
        case 3:
          formation.m++;
          break;
        case 4:
          formation.f++;
          break;
      }

      return validFormation();
    }

    if (player.useViceCaptain && footballer.is_vice_captain) {
      footballer.multiplier = 2;
      if (player.transferDetails.chip === '3xc') {
        footballer.multiplier = 3;
      }
    }

    if (footballer.liveScore) {
      footballer.liveScore *= footballer.multiplier;
      if (player.team.indexOf(footballer) < 11 || player.transferDetails.chip === 'bboost') {
        player.liveWeekTotal += footballer.liveScore;
      }
    }

    if (player.transferDetails.chip !== 'bboost') {
      if (footballer.didNotPlay) {
        footballer.didNotPlay = true;
        footballer.liveScore = '-';
        if (player.team.indexOf(footballer) < 11) {
          footballer.subOut = true;
          player.subsOut.push(footballer);
        }
      }

      if (player.subsOut.length > 0 && player.team.indexOf(footballer) > 10 && !footballer.didNotPlay) {
        for (let i = 0; i < player.subsOut.length; i++) {
          if (checkSub(player.subsOut[i], footballer)) {
            footballer.subIn = true;
            if (footballer.liveScore) {
              player.liveWeekTotal += footballer.liveScore;
            }

            player.subsOut.splice(i, 1);
          }
        }
      }
    }

    player.weekScores[gameDetails.thisGameWeek].points = player.liveWeekTotal;
    player.weekScores[gameDetails.thisGameWeek].netScore =
        player.liveWeekTotal - player.weekScores[gameDetails.thisGameWeek].event_transfers_cost;

    logger.info('Live scores retrieved for '
        + player.player_name + ' (' + footballer.position + '/15)' + timeToLoad());

    fpl.getMonthScores(player);
    liveScoreCounter++;
    if (liveScoreCounter === Object.keys(players).length * 15) {
      tables = [];
      fpl.createTables();
      fpl.overallTable();
    }
  },

  createTables() {
    logger.info('Creating tables');
    let i = 1;
    while (i < gameDetails.months.length) {
      const table = {
        month: gameDetails.months[i].name,
        content: fpl.createTable(gameDetails.months[i].name),
      };

      const prize = 5 * (gameDetails.months[i].stop_event - gameDetails.months[i].start_event + 1);
      table.content[0].prize = prize;

      Object.keys(players).forEach(player => {
        if (table.content[0].name === players[player].player_name && table.month !== gameDetails.currentMonth) {
          players[player].prizeMoney += prize;
        }
      });

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

    Object.keys(players).forEach(player => {
      for (let i = 0; i < 2; i++) {
        if (overallTable[i].name === players[player].player_name
            && gameDetails.thisGameWeek === 38
            && gameDetails.thisGameWeekFinished) {
          players[player].prizeMoney += overallTable[i].prize;
        }
      }
    });

    logger.info('Overall table created ' + timeToLoad());
    fpl.cup();

    playersSorted = [];
    Object.keys(players).forEach(function (player) {
      playersSorted.push(players[player]);
    });

    playersSorted.sort(function (a, b) {
      if (a.total !== b.total) {
        return b.total - a.total;
      } else {
        return a.transferDetails.totalTransfers - b.transferDetails.totalTransfers;
      }
    });
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
    logger.info('table created for ' + month + ' ' + timeToLoad());
    return table;
  },

  cup() {
    cup = [];
    const cupWeeks = [1, 8, 15, 22, 30, 38];
    cupWeeks.forEach(function (gameWeek) {
      let matchDay = {
        gameWeek: gameWeek,
        events: {},
      };
      cup.push(matchDay);
    });

    function Event(name) {
      this.name = name;
      this.fixtures = [];
    }

    cup[0].events.superCup = new Event('Super Cup');
    cup[0].events.qualifiers = new Event('Qualifiers');
    for (let i = 1; i < 6; i++) {
      if (i < 4) {
        cup[i].events.groupA = new Event('Group A');
        cup[i].events.groupB = new Event('Group B');
      }

      cup[i].events.scruds = new Event('Scruds');
    }

    cup[4].events.semiFinal = new Event('Semi-Final');
    cup[5].events.final = new Event('Final');

    function getWinner(match, gameWeek, league) {
      let winner;
      let loser;
      let draw = false;
      if (match.score1 > match.score2) {
        winner = match.team1;
        loser = match.team2;
      } else if (match.score1 < match.score2) {
        winner = match.team2;
        loser = match.team1;
      } else {
        winner = 'Draw';
        loser = 'Draw';
        draw = true;
      }

      match.winner = winner;
      match.loser = loser;

      if (league) {
        addPoints(winner, loser, gameWeek);

        if (draw) {
          addDrawPoints(match.team1, match.team2, gameWeek);
        }
      }
    }

    function addPoints(winner, loser, gameWeek) {
      winner.tableEntry.played++;
      winner.tableEntry.won++;
      winner.tableEntry.for += winner.weekScores[gameWeek].netScore;
      winner.tableEntry.against += loser.weekScores[gameWeek].netScore;
      winner.tableEntry.points += 3;

      loser.tableEntry.played++;
      loser.tableEntry.lost++;
      loser.tableEntry.for += loser.weekScores[gameWeek].netScore;
      loser.tableEntry.against += winner.weekScores[gameWeek].netScore;
    }

    function addDrawPoints(team1, team2, gameWeek) {
      team1.tableEntry.played++;
      team1.tableEntry.drawn++;
      team1.tableEntry.for += team1.weekScores[gameWeek].netScore;
      team1.tableEntry.against += team2.weekScores[gameWeek].netScore;
      team1.tableEntry.points++;

      team2.tableEntry.played++;
      team2.tableEntry.drawn++;
      team2.tableEntry.for += team2.weekScores[gameWeek].netScore;
      team2.tableEntry.against += team1.weekScores[gameWeek].netScore;
      team2.tableEntry.points++;
    }

    function Fixture(team1, team2, gameWeek, league) {
      this.team1 = team1;
      this.team2 = team2;
      if (gameWeek <= gameDetails.thisGameWeek) {
        this.score1 = team1.weekScores[gameWeek].netScore;
        this.score2 = team2.weekScores[gameWeek].netScore;
        if (gameWeek < gameDetails.thisGameWeek || gameDetails.thisGameWeekFinished) {
          getWinner(this, gameWeek, league);
        }
      }
    }

    function createMatches(matchDay, event, teams, gameWeek, league) {
      const noOfMatches = teams.length / 2;
      for (let i = 0; i < noOfMatches; i++) {
        cup[matchDay].events[event].fixtures.push(
            new Fixture(teams[i * 2], teams[i * 2 + 1], gameWeek, league));
      }
    }

    const superCup = [
      players[1940767],
      players[998490],
    ];
    createMatches(0, 'superCup', superCup, cupWeeks[0], false);
    cup[0].events.superCup.fixtures[0].winner.prizeMoney += 10;
    const qualifiers = [
      players[119880],
      players[2089907],//0
      players[330128],
      players[1952631],//1
      players[1974840],
      players[18217],//2
      players[2849225],
      players[319619],//3
      players[4045],
      players[1660123],//4
    ];
    createMatches(0, 'qualifiers', qualifiers, cupWeeks[0], false);
    const bye = players[1971796];
    logger.info('Matchday 1 created');

    function TableEntry() {
      this.played = 0;
      this.won = 0;
      this.drawn = 0;
      this.lost = 0;
      this.for = 0;
      this.against = 0;
      this.difference = function () {
        return this.for - this.against;
      };

      this.points = 0;
    }

    Object.keys(players).forEach(function (player) {
      players[player].tableEntry = new TableEntry();
    });

    const groupA = [//1234,1324,1423
      cup[0].events.qualifiers.fixtures[4].winner,//cn
      cup[0].events.qualifiers.fixtures[3].winner,//pok
      cup[0].events.superCup.fixtures[0].winner,//pk
      cup[0].events.superCup.fixtures[0].loser,//ros
    ];
    const elite2a = [groupA[0], groupA[2], groupA[1], groupA[3]];
    const elite3a = [groupA[0], groupA[3], groupA[1], groupA[2]];

    const groupB = [//1234,1324,1423
      bye,//mc
      cup[0].events.qualifiers.fixtures[1].winner,//bd
      cup[0].events.qualifiers.fixtures[0].winner,//mg
      cup[0].events.qualifiers.fixtures[2].winner,//md
    ];
    const elite2b = [groupB[0], groupB[2], groupB[1], groupB[3]];
    const elite3b = [groupB[0], groupB[3], groupB[1], groupB[2]];

    const scruds = [// 1234, 1325, 1524, 1435, 2345
      cup[0].events.qualifiers.fixtures[2].loser,//mn
      cup[0].events.qualifiers.fixtures[0].loser,//dm
      cup[0].events.qualifiers.fixtures[3].loser,//jm
      cup[0].events.qualifiers.fixtures[1].loser,
      cup[0].events.qualifiers.fixtures[4].loser,//pb
    ];
    const scruds1 = scruds.slice(0, 4);
    const scruds2 = [scruds[0], scruds[2], scruds[1], scruds[4]];
    const scruds3 = [scruds[0], scruds[4], scruds[1], scruds[3]];
    const scruds4 = [scruds[0], scruds[3], scruds[2], scruds[4]];
    const scruds5 = scruds.slice(1);

    function CupTable(name, group) {
      this.name = name;
      this.group = group;
    }

    cupTables = {
      groupA: new CupTable('Group A', groupA),
      groupB: new CupTable('Group B', groupB),
      scruds: new CupTable('Scruds', scruds),
    };

    function sortGroup(group) {
      group.sort(function (a, b) {
        if (a.tableEntry.points !== b.tableEntry.points) {
          return b.tableEntry.points - a.tableEntry.points;
        } else {
          return b.tableEntry.difference() - a.tableEntry.difference();
        }
      });
    }

    createMatches(1, 'groupA', groupA, cupWeeks[1], true);
    createMatches(1, 'groupB', groupB, cupWeeks[1], true);
    createMatches(1, 'scruds', scruds1, cupWeeks[1], true);
    Object.keys(cupTables).forEach(function (group) {
      sortGroup(cupTables[group].group);
    });

    logger.info('Matchday 2 created');

    createMatches(2, 'groupA', elite2a, cupWeeks[2], true);
    createMatches(2, 'groupB', elite2b, cupWeeks[2], true);
    createMatches(2, 'scruds', scruds2, cupWeeks[2], true);
    Object.keys(cupTables).forEach(function (group) {
      sortGroup(cupTables[group].group);
    });

    logger.info('Matchday 3 created');

    createMatches(3, 'groupA', elite3a, cupWeeks[3], true);
    createMatches(3, 'groupB', elite3b, cupWeeks[3], true);

    createMatches(3, 'scruds', scruds3, cupWeeks[3], true);
    Object.keys(cupTables).forEach(function (group) {
      sortGroup(cupTables[group].group);
    });

    logger.info('Matchday 4 created');

    function Placeholder(name) {
      this.player_name = name;
    }

    let semi = [
      new Placeholder('Winner Group A'),
      new Placeholder('Runner-up Group B'),
      new Placeholder('Winner Group B'),
      new Placeholder('Runner-up Group A'),
    ];
    if (cupWeeks[3] <= gameDetails.thisGameWeek && gameDetails.thisGameWeekFinished) {
      semi = [
        cupTables.groupA.group[0],
        cupTables.groupB.group[1],
        cupTables.groupB.group[0],
        cupTables.groupA.group[1],
      ];
    }

    createMatches(4, 'semiFinal', semi, cupWeeks[4], false);
    createMatches(4, 'scruds', scruds4, cupWeeks[4], true);
    sortGroup(cupTables.scruds.group);

    logger.info('Matchday 5 created');

    let final = [
      new Placeholder('Winner Semi-Final 1'),
      new Placeholder('Winner Semi-Final 2'),
    ];
    if (cupWeeks[4] <= gameDetails.thisGameWeek && gameDetails.thisGameWeekFinished) {
      final = [
        cup[4].events.semiFinal.fixtures[0].winner,
        cup[4].events.semiFinal.fixtures[1].winner,
      ];
    }

    createMatches(5, 'final', final, cupWeeks[5], false);

    createMatches(5, 'scruds', scruds5, cupWeeks[5], true);
    sortGroup(cupTables.scruds.group);

    logger.info('Matchday 6 created');
    logger.info('Cup data assembled' + timeToLoad());

    cupTables.scruds.group[0].prize = 50;
    cup[0].events.superCup.fixtures[0].prize = 10;
    cup[5].events.final.fixtures[0].prize = 80;

    if (cupWeeks[5] <= gameDetails.thisGameWeek && gameDetails.thisGameWeekFinished) {
      cup[5].events.final.fixtures[0].winner.prizeMoney += 80;
      cupTables.scruds.group[0].prizeMoney += 50;
    }

    prizesSorted = [];
    Object.keys(players).forEach(function (player) {
      if (players[player].prizeMoney !== 0) {
        prizesSorted.push(players[player]);
      }
    });

    prizesSorted.sort(function (a, b) {
      return b.prizeMoney - a.prizeMoney;
    });

    loading = false;
  },

  index(request, response) {
    const viewData = {
      title: 'Fantasy Football',
      players: playersSorted,
      prizes: prizesSorted,
      gameDetails: gameDetails,
      tables: tables,
      loading: loading,
      overallTable: overallTable,
      cup: cup,
      cupTables: cupTables,
    };

    // logger.info('Rendering index');
    response.render('index', viewData);
  },

};

module.exports = fpl;
