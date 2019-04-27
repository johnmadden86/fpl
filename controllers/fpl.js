/** @format */

const axios = require('axios');
const _ = require('lodash');
// const Bottleneck = require('bottleneck');
const axiosRetry = require('axios-retry');
const singleLineLog = require('log-update');

// eslint-disable-next-line no-unused-vars
const Handlebars = require('../utils/handlebar-helper');

const leagueCode = 484626;

let time = new Date();

const timeToLoad = () => {
  let ttl = new Date() - time;
  ttl /= 1000;
  return ` in ${ttl} secs`;
};

const imageUrl = code =>
  `https://platform-static-files.s3.amazonaws.com/premierleague/photos/players/110x140/p${code}.png`;

const sumArray = array => (array.length === 0 ? 0 : array.reduce((tot, val) => tot + val));

const meanArray = array => {
  if (array.length === 0) {
    return 0;
  }
  return array.reduce((tot, val, index, arr) => {
    let r = tot;
    r += val;

    if (index === arr.length - 1) {
      return r / arr.length;
    }
    return r;
  });
};

const s = [];

const medianArray = array => {
  const copy = [...array];
  const n = copy.length;
  copy.sort((a, b) => a - b);
  return n % 2 === 1 ? copy[Math.floor(n / 2)] : meanArray(copy.slice(n / 2 - 1, n / 2 + 1));
};

const range = array => {
  const copy = [...array];
  const n = copy.length;
  copy.sort((a, b) => a - b);
  const lower = copy.slice(0, Math.ceil(n / 2));
  const upper = copy.slice(Math.floor(n / 2));
  return [Math.min(...copy), medianArray(lower), medianArray(copy), medianArray(upper), Math.max(...copy)];
};

let loading;

// const limiter = new Bottleneck({ maxConcurrent: 10, minTime: 1000 });

const req = async url => {
  const fplRequest = axios.create({ baseURL: 'https://fantasy.premierleague.com/drf/', method: 'GET' });
  axiosRetry(fplRequest, { retries: 10 /* , retryDelay: axiosRetry.exponentialDelay */ });
  return (await fplRequest(url)).data;
};

const staticData = { phases: [], footballers: [] };
const leagueData = { users: [], tables: [] };

// const arrToObj = arr => arr.reduce((obj, elem) => ({ ...obj, [elem.id]: elem }), {});

const fpl = {
  async runApp() {
    const liveUpdate = async () => {
      const fixtureKickOffTimes = await fpl.liveFootballerScores(staticData.footballers);
      console.log(`Live scores gathered for ${staticData.footballers.length} footballers${timeToLoad()}`);
      return fixtureKickOffTimes;
    };
    const weekly = async () => {
      loading = true;
      // const tasks = [];
      time = new Date();
      // tasks.push(Object.assign(staticData, await fpl.getStaticData()));
      Object.assign(staticData, await fpl.getStaticData());
      if (staticData.updating) {
        console.log(`Game is updating...`);
      } else {
        const { deadline_time_epoch: epoch, deadline_time_game_offset: offset } = staticData.nextGw;
        const nextUpdate = new Date((epoch - offset + 60 * 45) * 1000);
        Object.assign(staticData, { footballers: await fpl.getFootballers() });
        const fixtureKickOffTimes = [];
        // tasks.push(Object.assign(fixtureKickOffTimes, await liveUpdate()));
        Object.assign(fixtureKickOffTimes, await liveUpdate());
        // tasks.push(Object.assign(leagueData.users, await fpl.getLeagueData(leagueCode)));
        // await Promise.all(tasks);
        await fpl.getLeagueData(leagueCode);

        const fixtureTimes = fixtureKickOffTimes.map(f =>
          Object.assign({
            kickoff: new Date(Date.parse(f) + 1000 * 60 * 5),
            finish: new Date(Date.parse(f) + 1000 * 60 * 60 * 2.5)
          })
        );

        return {
          fixtureTimes,
          nextUpdate
        };
      }
    };
    const run = async details => {
      const { fixtureTimes, nextUpdate } = details;
      const t = new Date();
      // console.error(fixtureTimes);
      const inProgress = fixtureTimes.some(fixture => fixture.kickoff < t && t < fixture.finish);
      const adjustment = t.getSeconds() % 5;
      // console.error(t, inProgress);
      if (t.getMinutes() % 2 === 0 && t.getSeconds() === 0 && inProgress) {
        console.log('Getting live update');
        await liveUpdate();
        for (const user of leagueData.users) {
          // repeated in get user data
          const { picks, subsOut, chip, gameweekScores, liveWeekTotal, pointsHit } = user;
          Object.assign(user, {
            liveWeekTotal: this.userLiveScores(picks, subsOut, chip)
          });
          // console.error(user.userName, user.liveWeekTotal);

          Object.assign(user.phaseScores, this.userScores(gameweekScores, liveWeekTotal, pointsHit));
          Object.assign(leagueData.tables, this.tableSort());
        }
      }
      if (t > nextUpdate) {
        Object.assign(details, await weekly());
      }
      const timeout = (5 - adjustment) * 1000;
      setTimeout(run, timeout, details);
    };
    try {
      const details = await weekly();
      await run(details);
    } catch (e) {
      throw e;
    }
  },

  /*
   * Retrieve and assemble the game's "static" data
   */
  async getStaticData() {
    try {
      const events = await req('events');
      if (typeof events === 'string') {
        return { updating: true };
      }
      console.log(`${events.length} events loaded in${timeToLoad()}`);
      const currentGw = events.find(e => e.is_current === true);
      const nextGw = events.find(e => e.is_next === true);
      console.log(`Current Gameweek: ${currentGw.id}, Next Gameweek: ${nextGw.id}`);
      const fixtures = await req('fixtures');
      console.log(`${fixtures.length} fixtures loaded in${timeToLoad()}`);
      const phases = await req('phases');
      console.log(`${phases.length} phases loaded in${timeToLoad()}`);
      for (const phase of phases) {
        phase.table = { name: phase.name, entries: [] };
      }
      // teams = (await request('teams')).data;
      return { events, currentGw, nextGw, phases, fixtures, updating: false };
    } catch (e) {
      // console.log(e);
      throw e;
    }
  },

  async getFootballers() {
    try {
      const footballers = await req('elements');
      footballers.map(footballer => Object.assign(footballer, { image: imageUrl(footballer.code) }));
      console.log(`${Object.keys(footballers).length} footballers loaded in${timeToLoad()}`);

      let i = 1;
      //  const maxNameLength = Math.max(...footballers.map(f => f.web_name.length));
      const getRating = async footballer => {
        const rating = await this.getStats(footballer);
        // singleLineLog(`Stats gathered for ${footballer.web_name.padEnd(maxNameLength)} ${i}/${footballers.length} ${timeToLoad()}`);
        if (i === footballers.length) {
          singleLineLog.clear();
          console.log(`Stats for ${footballers.filter(p => p.rating).length} footballers gathered${timeToLoad()}`);
          // let k = 3;
          // while (k > 0) {
          // const u = s; // .filter(t => t.bonus === k);
          // const inf = u.map(v => Number(v.influence));
          // const b = u.map(v => v.bps);
          // console.error(range(inf));
          // console.error(meanArray(inf));
          // console.error(range(b));
          // console.error(meanArray(b));
          // const ratio = range(inf).map((ri, index) => Math.round((100 * ri) / range(b)[index]) / 100);
          // console.error(ratio);
          // k -= 1;
          // }
        }
        i += 1;
        Object.assign(footballer, { rating });
      };

      let timeout = 0;
      const tasks = [];
      for (const footballer of footballers) {
        tasks.push(setTimeout(getRating, timeout, footballer));
        timeout += 100;
      }

      await Promise.all(tasks);
      return footballers;
    } catch (e) {
      throw e;
    }
  },

  async getStats(footballer) {
    try {
      const games = (await req(`element-summary/${footballer.id}`)).history;
      const pointsPerGoal = footballer.element_type <= 2 ? 6 : 8 - footballer.element_type;
      const top6 = [1, 6, 12, 13, 14, 17];
      for (const game of games) {
        const p = 1 + game.round / 10;
        game.formWeight = p ** p;
        game.attackRating = game.threat * pointsPerGoal + game.creativity * 3;
        game.influencePerBps = game.bps === 0 ? 0 : game.influence / game.bps;
        if (game.bonus > 0) {
          s.push({
            influence: game.influence,
            bps: game.bps,
            bonus: game.bonus
          });
        }
      }
      const gamesPlayedIn = games.filter(game => game.minutes > 0);
      // Object.assign(footballer, { appearances: gamesPlayedIn.length });
      footballer.appearances = gamesPlayedIn.length;
      const attackRatings = gamesPlayedIn.map(game => game.attackRating);
      let influencePerBps = gamesPlayedIn.map(game => game.influencePerBps);
      influencePerBps = meanArray(influencePerBps);
      const total = Math.round(sumArray(attackRatings));
      const attackRatingsWeighted = gamesPlayedIn.map(game => game.attackRating * game.formWeight);
      const homeGames = gamesPlayedIn.filter(game => game.was_home && !top6.includes(game.opponent_team));
      const awayGames = gamesPlayedIn.filter(game => !game.was_home && !top6.includes(game.opponent_team));
      const top6Games = gamesPlayedIn.filter(game => top6.includes(game.opponent_team));
      const homeAttackRatings = homeGames.map(game => game.attackRating);
      const awayAttackRatings = awayGames.map(game => game.attackRating);
      const top6AttackRatings = top6Games.map(game => game.attackRating);
      const bottom14AttackRatings = homeAttackRatings.concat(awayAttackRatings);
      const formWeights = gamesPlayedIn.map(game => game.formWeight);
      const formWeightsSum = sumArray(formWeights);
      const form = formWeightsSum === 0 ? 0 : Math.round(sumArray(attackRatingsWeighted) / formWeightsSum);
      if (footballer.id === 280) {
        console.error(formWeights.map(fw => (100 * fw) / formWeightsSum));
      }

      return {
        total,
        performance: influencePerBps,
        median: Math.round(medianArray(attackRatings)),
        perGame: Math.round(meanArray(attackRatings)),
        per90mins: footballer.minutes === 0 ? 0 : Math.round((90 * total) / footballer.minutes),
        perHomeGame: Math.round(medianArray(homeAttackRatings)),
        perAwayGame: Math.round(medianArray(awayAttackRatings)),
        perTop6Game: Math.round(medianArray(top6AttackRatings)),
        perBottom14Game: Math.round(medianArray(bottom14AttackRatings)),
        form,
        value: Math.round(form / (footballer.now_cost / 100)) / 10
      };
    } catch (e) {
      throw e;
    }
  },

  /*
   * Calculate live matchday scores
   * --> get bonus
   * --> apply bonus
   */
  // eslint-disable-next-line no-shadow
  async liveFootballerScores(footballers) {
    try {
      const { elements, fixtures } = await req(`event/${staticData.currentGw.id}/live`);
      const fixtureKickOffTimes = fixtures.map(f => new Date(f.kickoff_time));
      for (const footballer of footballers) {
        // console.error(footballer.id);
        const { explain, stats } = elements[footballer.id];
        const fixtureId = explain[0] ? explain[0][1] : null;
        const minutes = explain[0] ? explain[0][0].minutes.value : 0;
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (fixture && fixture.started) {
          footballer.didNotPlay = minutes === 0;
          footballer.liveScore = stats.total_points;
        }
      }

      for (const fixture of fixtures) {
        let bonusApplied = fixture.stats[8];
        if (bonusApplied) {
          bonusApplied = fixture.stats[8].bonus.a.length + fixture.stats[8].bonus.h.length > 0;
        }
        if (!bonusApplied && fixture.started) {
          const bonus = this.getBonus(fixture);
          this.applyBonus(footballers, bonus);
        }
      }

      return fixtureKickOffTimes;
    } catch (e) {
      throw e;
    }
  },

  /*
   * Returns the players that have scored bonus points
   */
  getBonus(fixture) {
    const three = [];
    const two = [];
    const one = [];
    if (fixture.stats.length > 0) {
      const bpsAway = fixture.stats[9].bps.a;
      const bpsHome = fixture.stats[9].bps.h;
      const bps = bpsAway.concat(bpsHome);
      const isDefined = currentValue => Object.prototype.hasOwnProperty.call(currentValue, 'value');
      // console.error(bps);
      // console.error(bps.every(isDefined));
      if (bps.every(isDefined)) {
        bps.sort((a, b) => b.value - a.value);

        let threeBonusCount = 0;
        let twoBonusCount = 0;
        let oneBonusCount = 0;
        let i = 0;
        while (bps[0].value === bps[i].value) {
          threeBonusCount += 1;
          i += 1;
        }

        while (threeBonusCount === 1 && bps[1].value === bps[i].value) {
          twoBonusCount += 1;
          i += 1;
        }

        while (threeBonusCount + twoBonusCount === 2 && bps[2].value === bps[i].value) {
          oneBonusCount += 1;
          i += 1;
        }

        let j = 0;
        while (j < threeBonusCount) {
          three.push(bps[j].element);
          j += 1;
        }
        while (j < threeBonusCount + twoBonusCount) {
          two.push(bps[j].element);
          j += 1;
        }
        while (j < threeBonusCount + twoBonusCount + oneBonusCount) {
          one.push(bps[j].element);
          j += 1;
        }
      }
    }
    return [one, two, three];
  },

  /*
   * Adds bonus points to footballer's live total
   */
  applyBonus(footballers, bonus) {
    function apply(arr, points) {
      for (const element of arr) {
        const footballer = footballers.find(f => f.id === element);
        footballer.liveScore += points;
      }
    }

    for (let i = 0; i < bonus.length; i += 1) {
      apply(bonus[i], i + 1);
    }
  },

  /*
   * Get user data for league
   * --> get user data
   */
  async getLeagueData(leagueId) {
    try {
      const users = (await req(`leagues-classic-standings/${leagueId}`)).standings.results;
      const maxNameLength = Math.max(...users.map(u => u.player_name.length));
      let i = 1;
      let timeout = 0;
      const getUserDetails = async user => {
        const { userId, userName } = user;
        const { tableEntries, ...r } = await this.getUserData(userId, userName);
        for (const [index, value] of tableEntries.entries()) {
          staticData.phases[index].table.entries.push(value);
        }
        console.log(`Data gathered for ${userName.padEnd(maxNameLength)} ${i}/${users.length}${timeToLoad()}`);
        if (i === users.length) {
          // singleLineLog.clear();
          console.log(`${users.length} users retrieved${timeToLoad()}`);
          Object.assign(leagueData.tables, this.tableSort());
          loading = false;
        }
        i += 1;
        Object.assign(user, r);
        leagueData.users.push(user);
      };

      const tasks = [];
      for (let user of users) {
        const { entry: userId, player_name: userName } = user;
        user = { userId, userName };
        tasks.push(setTimeout(getUserDetails, timeout, user));
        timeout += 1000;
      }
      await Promise.all(tasks);
    } catch (e) {
      throw e;
    }
  },

  /*
   * get individual user data
   *
   * picks for gameweek
   * transfers
   * formation
   * live gameweek score
   * past gameweek scores
   * scores
   */
  async getUserData(id, name) {
    try {
      const { picks, captain, viceCaptain, useViceCaptain, chip, pointsHit, subsOut, unchanged } = await this.userPicks(
        id
      );
      const gameweekTransfers = await this.userTransfers(id);
      const formation = await this.getFormation(picks);

      const liveWeekTotal = this.userLiveScores(picks, subsOut, chip); //

      const { chips, entry, leagues, season, history } = await req(`entry/${id}/history`);
      const gameweekScores = this.pastUserScores(entry, history);

      const phaseScores = this.userScores(gameweekScores, liveWeekTotal, pointsHit); //

      const tableEntries = phaseScores.map(score => ({ name, score }));

      return {
        picks,
        captain,
        viceCaptain,
        useViceCaptain,
        chip,
        pointsHit,
        subsOut,
        gameweekTransfers,
        formation,
        liveWeekTotal,
        chips,
        entry,
        leagues,
        season,
        history,
        gameweekScores,
        phaseScores,
        tableEntries,
        unchanged
      };
    } catch (e) {
      throw e;
    }
  },

  tableSort() {
    const tables = staticData.phases.map(phase => phase.table).filter(table => table.entries.length > 0);

    for (const [index, table] of tables.entries()) {
      table.entries.sort((a, b) => b.score - a.score);
      if (index === 0) {
        table.entries[0].prize = 220;
        table.entries[1].prize = 100;
        table.entries[2].prize = 50;
      } else if (index === 1 || index === 11) {
        table.entries[0].prize = 10;
      } else if (index === 3) {
        table.entries[0].prize = 10;
        table.entries[1].prize = 10;
      } else {
        table.entries[0].prize = 20;
      }
    }
    return tables;
  },

  async userPicks(id) {
    try {
      const { active_chip: chip, entry_history: history, picks } = await req(
        `entry/${id}/event/${staticData.currentGw.id}/picks`
      );
      const { picks: lastWeeksPicks } = await req(`entry/${id}/event/${staticData.currentGw.id - 1}/picks`);
      const unchanged = _.isEqual(lastWeeksPicks, picks);
      const pointsHit = history.event_transfers_cost * -1;
      let captain;
      let viceCaptain;
      let useViceCaptain = false;
      let viceCaptainScore;
      const subsOut = [];
      const captMultiplier = picks.find(pick => pick.is_captain).multiplier;
      for (const pick of picks) {
        const footballer = staticData.footballers.find(f => f.id === pick.element);
        Object.assign(pick, footballer);
        if (pick.didNotPlay && pick.position <= 11) {
          subsOut.push(pick);
        }
        if (pick.liveScore) {
          pick.liveScore *= pick.multiplier;
        }
        if (pick.is_captain) {
          captain = pick.web_name;
          if (pick.didNotPlay) {
            useViceCaptain = true;
          }
        }
        if (pick.is_vice_captain) {
          viceCaptain = pick.web_name;
          viceCaptainScore = pick.liveScore;
        }
      }
      if (useViceCaptain) {
        const viceCapt = picks.find(pick => pick.is_vice_captain);
        if (viceCapt.multiplier === 1 && viceCapt.liveScore) {
          viceCapt.liveScore *= captMultiplier;
        }
      }

      picks.sort((a, b) => a.position - b.position);
      return {
        picks,
        captain,
        viceCaptain,
        useViceCaptain,
        viceCaptainScore,
        chip,
        pointsHit,
        subsOut,
        unchanged
      };
    } catch (e) {
      throw e;
    }
  },

  pastUserScores(entry, history) {
    const gameweekScores = [];
    for (let i = 0; i < history.length; i += 1) {
      const netScore = history[i].points - history[i].event_transfers_cost;
      gameweekScores.push(netScore);
    }
    for (let i = history.length; i < staticData.currentGw.id; i += 1) {
      gameweekScores.unshift(0);
    }
    return gameweekScores;
  },

  userScores(gameweekScores, liveWeekTotal, pointsHit) {
    const netScoreThisWeek = liveWeekTotal + pointsHit;
    if (gameweekScores.length === staticData.currentGw.id) {
      // replace gw score
      gameweekScores[staticData.currentGw.id - 1] = netScoreThisWeek;
    } else {
      // insert gw score
      gameweekScores.push(netScoreThisWeek);
    }
    const phaseScores = [];
    for (const phase of staticData.phases) {
      const start = phase.start_event - 1;
      const end = phase.stop_event;
      const scores = gameweekScores.slice(start, end);
      const score = sumArray(scores);
      phaseScores.push(score);
    }
    return phaseScores;
  },

  async userTransfers(id) {
    const { history, wildcards } = await req(`entry/${id}/transfers`);
    const wildcardWeeks = wildcards.map(w => w.event);
    const transferWeeks = history.map(h => h.event).filter(t => !wildcardWeeks.includes(t));
    const transferHistory = [];
    for (const phase of staticData.phases) {
      const d = transferWeeks.filter(v => phase.start_event <= v && v <= phase.stop_event);
      transferHistory.push({ name: phase.name, transfers: d.length });
    }
    const gameweekTransfers = history.filter(transfer => transfer.event === staticData.currentGw.id);
    for (const transfer of gameweekTransfers) {
      transfer.playerIn = staticData.footballers.find(f => f.id === transfer.element_in).web_name;
      transfer.playerOut = staticData.footballers.find(f => f.id === transfer.element_out).web_name;
    }
    return gameweekTransfers;
  },

  getFormation(squad) {
    const team = squad.slice(0, 11);
    const gk = team.filter(player => player.element_type === 1).length;
    const df = team.filter(player => player.element_type === 2).length;
    const mf = team.filter(player => player.element_type === 3).length;
    const fw = team.filter(player => player.element_type === 4).length;
    return { g: gk, d: df, m: mf, f: fw };
  },

  userLiveScores(picks, subsOut, chip) {
    const validFormation = formation => {
      const eleven = formation.g + formation.d + formation.m + formation.f === 11;
      const positions = formation.g === 1 && formation.d >= 3 && formation.f >= 1;
      return eleven && positions;
    };
    const swap = (arr, i, j) => {
      [arr[i], arr[j]] = [arr[j], arr[i]];
    };

    const squad = Object.assign([], picks);

    if (chip === 'bboost') {
      const scorers = squad.filter(scorer => scorer.liveScore);
      const scores = scorers.map(p => (Number.isNaN(p.liveScore) ? 0 : p.liveScore));
      return sumArray(scores);
    }

    const subsIn = squad.slice(11);

    const markSubs = (subOut, subIn) => {
      picks.find(p => p.element === subOut.element).subOut = true;
      picks.find(p => p.element === subIn.element).subIn = true;
    };

    for (const subOut of subsOut) {
      let i = 0;
      while (i < subsIn.length) {
        if (!subsIn[i].didNotPlay) {
          swap(squad, subOut.position - 1, subsIn[i].position - 1);
          if (validFormation(this.getFormation(squad))) {
            console.log(`Out: ${subOut.web_name}`, `In: ${subsIn[i].web_name}`);
            markSubs(subOut, subsIn[i]);
            subsIn.splice(i, 1);
            break;
          }
          swap(squad, subsIn[i].position - 1, subOut.position - 1);
        }
        i += 1;
      }
    }

    const scorers = squad.slice(0, 11).filter(scorer => scorer.liveScore);
    const scores = scorers.map(scorer => (Number.isNaN(scorer.liveScore) ? 0 : scorer.liveScore));
    return sumArray(scores);
  },

  index(r, response) {
    const {
      phases,
      currentGw: { id: gw }
    } = staticData;
    const tables = phases.filter(phase => phase.start_event <= gw).map(phase => phase.table);
    const { users } = leagueData;
    let picks = [];
    for (const user of users) {
      picks = picks.concat(user.picks);
    }
    picks = picks.map(m => m.web_name);
    picks.sort();
    let mostPicked = [];
    for (const pick of picks) {
      if (mostPicked.map(mp => mp.name).includes(pick)) {
        mostPicked.find(mp => mp.name === pick).count += 1;
      } else {
        mostPicked.push({ name: pick, count: 1 });
      }
    }
    mostPicked = mostPicked.filter(mp => mp.count > 2);
    mostPicked.sort((a, b) => {
      if (a.count === b.count) {
        if (a.name === b.name) {
          return 0;
        }
        return a.name < b.name ? -1 : 1;
      }
      return b.count - a.count;
    });
    const data = {
      title: 'Fantasy Football',
      players: users,
      loading,
      tables,
      mostPicked
    };

    response.render('index', data);
  },

  stats(r, response) {
    const gw33 = [
      1, // Arsenal
      2, // Bournemouth
      // 3, // Brighton
      4, // Burnley
      // 5, // Cardiff
      6, // Chelsea
      7, // Crystal Palace
      8, // Everton
      // 9, // Fulham
      10, // Huddersfield
      11, // Leicester
      12, // Liverpool
      // 13, // Man City
      // 14, // Man Utd
      15, // Newcastle
      16, // Southampton
      // 17, // Spurs
      // 18, // Watford
      19 // West Ham
      // 20 // Wolves
    ];
    const gw36 = [
      1, // Arsenal
      2, // Bournemouth
      3, // Brighton
      4, // Burnley
      5, // Cardiff
      6, // Chelsea
      7, // Crystal Palace
      8, // Everton
      9, // Fulham
      10, // Huddersfield
      11, // Leicester
      12, // Liverpool
      13, // Man City
      14, // Man Utd
      15, // Newcastle
      16, // Southampton
      17, // Spurs
      18, // Watford
      19, // West Ham
      20 // Wolves
    ];
    const data = {
      title: 'Stats',
      footballers: Object.values(staticData.footballers).filter(
        f =>
          f.rating &&
          // f.rating.median > 75 &&
          // f.rating.form >= 175 &&
          // f.rating.value >= 20 &&
          // f.now_cost <= 102 &&
          // f.element_type === 3 &&
          // gw33.includes(f.team) &&
          // gw36.includes(f.team) &&
          // !blank.includes(f.team) &&
          // f.team === 15 &&
          f.appearances >
            0 /* &&
          ((f.rating.perTop6Game >= 300 && top6.includes(f.team)) ||
            (f.rating.perAwayGame >= 300 && away.includes(f.team)) ||
            (f.rating.perHomeGame >= 300 && home.includes(f.team))) */
      )
    };
    data.footballers.sort((a, b) => b.rating.form - a.rating.form);
    // data.footballers.sort((a, b) => b.rating.median - a.rating.median);
    // data.footballers.sort((a, b) => b.rating.value - a.rating.value);
    response.render('stats', data);
  }
};

module.exports = fpl;
