import type { PGlite } from '@electric-sql/pglite';
import type { Club, Session } from '../shared/model.ts';
import { doylePresets } from './doylePresets.ts';

export const clubs: Club[] = [
  { id: 'doyle', name: 'Doyle Poker', venue: 'Москва · Основной зал', accent: '#2bd98a' },
  { id: 'vyatka', name: 'Вятка Покер', venue: 'Киров · Основной зал', accent: '#7db1fd' },
];

export const sessions: Session[] = clubs.flatMap(club => [
  { token: club.id + '-admin', club, role: 'admin', table: null },
  { token: club.id + '-display', club, role: 'display', table: null },
  ...Array.from({ length: 20 }, (_, index) => index + 1).map(table => ({ token: club.id + '-dealer-' + table, club, role: 'dealer' as const, table })),
] satisfies Session[]);

const names = [
  'Александр Волков', 'Мария Орлова', 'Дмитрий Соколов', 'Анна Смирнова',
  'Максим Крылов', 'Екатерина Лебедева', 'Иван Морозов', 'Ольга Власова',
  'Сергей Беляев', 'Павел Новиков', 'Артём Фёдоров', 'Наталья Котова',
  'Виктор Романов', 'Валерия Ким', 'Роман Зайцев', 'Ирина Лукина',
  'Алексей Громов', 'Полина Жукова', 'Кирилл Егоров', 'Татьяна Сова',
];
const otherNames = ['Андрей Серов', 'Дарья Попова', 'Никита Зуев', 'Елена Миронова'];

const sources = ['Telegram', 'Instagram', 'Рекомендация', 'Сайт клуба', 'Яндекс Карты'];
const demoHandles = [
  'avolkov', 'morlova', 'dsokolov', 'asmirnova', 'mkrylov',
  'elebedeva', 'imorozov', 'ovlasova', 'sbelyaev', 'pnovikov',
  'afedorov', 'nkotova', 'vromanov', 'vkim', 'rzaitsev',
  'ilukina', 'agromov', 'pzhukova', 'kegorov', 'tsova',
];
const extraGuests = [
  { id: 'p21', name: 'Олег Титов', nickname: 'Titan', source: 'Instagram', tags: 'Спящий', phone: '+7 916 550-11-21', tg: '@otitov', ig: '@oleg.titov', consent: true, regDays: 44, lastVisitDays: 36, visits: 2 },
  { id: 'p22', name: 'Светлана Грачёва', nickname: '', source: 'Telegram', tags: 'Новичок', phone: '+7 926 550-11-22', tg: '@sgracheva', ig: '', consent: true, regDays: 26, lastVisitDays: 21, visits: 1 },
  { id: 'p23', name: 'Денис Волгин', nickname: 'DVolgin', source: 'Рекомендация', tags: 'Regular', phone: '+7 903 550-11-23', tg: '@dvolgin', ig: '@denis_volgin', consent: true, regDays: 50, lastVisitDays: 19, visits: 2 },
  { id: 'p24', name: 'Юлия Сафонова', nickname: '', source: 'Instagram', tags: 'Новичок', phone: '+7 999 550-11-24', tg: '@ysafonova', ig: '@yulia.safonova', consent: true, regDays: 5, lastVisitDays: null, visits: 0 },
  { id: 'p25', name: 'Михаил Костин', nickname: 'MKostin', source: 'Сайт клуба', tags: '', phone: '+7 915 550-11-25', tg: '', ig: '@m_kostin', consent: false, regDays: 3, lastVisitDays: null, visits: 0 },
];
const DAY = 86_400_000;

export async function seed(db: PGlite) {
  await db.transaction(async tx => {
    if ((await tx.query('SELECT id FROM clubs LIMIT 1')).rows.length) return;
    const now = Date.now();
    for (const club of clubs) {
      const live = club.id + '-main';
      const upcoming = club.id + '-next';
      await tx.query('INSERT INTO clubs VALUES ($1,$2,$3,$4)', [club.id, club.name, club.venue, club.accent]);
      await tx.query(
        "INSERT INTO tournaments (id, club_id, name, level, remaining, state, starts_at) VALUES ($1,$2,$3,3,762,'live',$6), ($4,$2,$5,0,1200,'scheduled',$7)",
        [
          live, club.id, club.id === 'doyle' ? 'Doyle Deepstack' : 'Кубок Вятки',
          upcoming, 'Вечерний турнир',
          new Date(now - 60 * 60_000).toISOString(),
          new Date(now + 2 * DAY).toISOString(),
        ]);
      await tx.query('INSERT INTO seats SELECT id,t,s FROM tournaments CROSS JOIN generate_series(1,3) t CROSS JOIN generate_series(1,8) s WHERE club_id=$1', [club.id]);

      const people = club.id === 'doyle' ? names : otherNames;
      for (const [index, name] of people.entries()) {
        const playerId = 'p' + (index + 1);
        const active = index < (club.id === 'doyle' ? 17 : 3);
        const seated = active && index < 15;
        const table = seated ? Math.floor(index / 5) + 1 : null;
        const seat = seated ? index % 5 + 1 : null;
        const out = club.id === 'doyle' && index === 19;
        const time = now - (30 + index) * 60_000;
        const regAt = now - (index < 6 ? (2 + index * 2) : (10 + index * 2)) * DAY;
        const handle = demoHandles[index] ?? ('player' + (index + 1));
        const phone = `+7 916 ${String(410 + index).padStart(3, '0')}-${String(10 + index).padStart(2, '0')}-${String(20 + index).padStart(2, '0')}`;
        const tg = index % 5 === 4 ? '' : '@' + handle;
        const ig = index % 3 === 0 ? '@' + handle + '_ig' : '';
        const consent = tg !== '' && index % 6 !== 5;
        const tags = index < 4 ? 'VIP, Регуляр' : index < 10 ? 'Регуляр' : index >= 16 ? 'Новичок' : '';
        const stage = index < 10 ? 'regular' : active || out ? 'first_visit' : 'registered';
        const owner = ['Администратор', 'Менеджер Анна', 'Флор Дмитрий'][index % 3];
        await tx.query(
          'INSERT INTO players (club_id,id,name,source,note,tags,phone,telegram,instagram,registered_at,telegram_consent,stage,owner) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          [
            club.id, playerId, name, sources[index % sources.length],
            index === 0 ? 'Предпочитает вечерние турниры' : '',
            tags, phone, tg, ig, regAt, consent, stage, owner,
          ],
        );
        await tx.query(
          'INSERT INTO entries (club_id,tournament_id,player_id,status,table_no,seat_no,last_table,visited_at,registered_at,reentries,original_buyin,busted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [club.id, live, playerId, out ? 'out' : active ? 'active' : 'registered', table, seat, out ? 1 : table, active || out ? time : null, time - 3 * 3_600_000, index < 2 ? 1 : 0, active || out ? 1500 : null, out ? time + 900_000 : null]);
        if (active || out) {
          await tx.query("INSERT INTO payments (club_id,tournament_id,player_id,amount,kind,time,original_amount) VALUES ($1,$2,$3,1500,'buyin',$4,1500)", [club.id, live, playerId, time]);
        }
        if (index < 2) {
          await tx.query("INSERT INTO payments (club_id,tournament_id,player_id,amount,kind,time,original_amount) VALUES ($1,$2,$3,1500,'reentry',$4,1500)", [club.id, live, playerId, time + 600_000]);
        }
        if (index < 4) {
          await tx.query("INSERT INTO payments (club_id,tournament_id,player_id,amount,kind,time,method,collected_at_tournament) VALUES ($1,$2,$3,1500,'payment',$4,$5,$2)", [club.id, live, playerId, time + 620_000, index % 2 ? 'cash' : 'card']);
        }
      }
      await tx.query('INSERT INTO journal (tournament_id,label,actor,time) VALUES ($1,$2,$3,$4),($1,$5,$6,$7)', [
        live, 'Турнир открыт', 'Администратор', now - 50 * 60_000, 'Открыты три стола', 'Флор', now - 20 * 60_000,
      ]);

      if (club.id === 'doyle') {
        for (const [gIdx, guest] of extraGuests.entries()) {
          const stage = guest.visits === 0 ? 'lead' : 'reactivation';
          const owner = ['Менеджер Анна', 'Администратор', 'Флор Дмитрий'][gIdx % 3];
          await tx.query(
            'INSERT INTO players (club_id,id,name,nickname,source,note,tags,phone,telegram,instagram,registered_at,telegram_consent,stage,owner) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
            [club.id, guest.id, guest.name, guest.nickname, guest.source, '', guest.tags, guest.phone, guest.tg, guest.ig, now - guest.regDays * DAY, guest.consent, stage, owner],
          );
        }

        // Прошлые завершённые турниры (полностью оплаченные; p1 оставляем чистым для базовых тестов кассы)
        const pastTournaments = [
          { id: 'doyle-past-1', name: 'Friday Bounty', daysAgo: 5, buyIn: 2000, attendees: ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p12'], noShows: ['p11', 'p24'] },
          { id: 'doyle-past-2', name: 'Sunday Deepstack', daysAgo: 12, buyIn: 2500, attendees: ['p2', 'p3', 'p5', 'p6', 'p8', 'p12', 'p13', 'p14'], noShows: ['p15', 'p18'] },
          { id: 'doyle-past-3', name: 'Weekly Classic', daysAgo: 21, buyIn: 1500, attendees: ['p2', 'p4', 'p7', 'p9', 'p22', 'p23'], noShows: ['p16'] },
          { id: 'doyle-past-4', name: 'Monthly Warmup', daysAgo: 36, buyIn: 2000, attendees: ['p3', 'p4', 'p10', 'p21', 'p23'], noShows: ['p25'] },
        ];
        for (const past of pastTournaments) {
          const ts = now - past.daysAgo * DAY;
          await tx.query(
            "INSERT INTO tournaments (id, club_id, name, level, remaining, state, starts_at) VALUES ($1,$2,$3,6,0,'finished',$4)",
            [past.id, club.id, past.name, new Date(ts).toISOString()],
          );
          for (const pid of past.attendees) {
            await tx.query(
              "INSERT INTO entries (club_id,tournament_id,player_id,status,visited_at,registered_at,original_buyin,busted_at) VALUES ($1,$2,$3,'out',$4,$5,$6,$7)",
              [club.id, past.id, pid, ts + 15 * 60_000, ts - 6 * 3_600_000, past.buyIn, ts + 3 * 3_600_000],
            );
            await tx.query(
              "INSERT INTO payments (club_id,tournament_id,player_id,amount,kind,time,original_amount) VALUES ($1,$2,$3,$4,'buyin',$5,$4)",
              [club.id, past.id, pid, past.buyIn, ts + 15 * 60_000],
            );
            await tx.query(
              "INSERT INTO payments (club_id,tournament_id,player_id,amount,kind,time,method,collected_at_tournament) VALUES ($1,$2,$3,$4,'payment',$5,'card',$2)",
              [club.id, past.id, pid, past.buyIn, ts + 25 * 60_000],
            );
          }
          for (const pid of past.noShows) {
            await tx.query(
              "INSERT INTO entries (club_id,tournament_id,player_id,status,visited_at,registered_at) VALUES ($1,$2,$3,'registered',NULL,$4)",
              [club.id, past.id, pid, ts - 8 * 3_600_000],
            );
          }
        }

        // Заметки сотрудников и история переписок
        await tx.query(
          'INSERT INTO player_notes (club_id,player_id,author,body,created_at) VALUES ($1,$2,$3,$4,$5),($1,$6,$7,$8,$9),($1,$10,$11,$12,$13)',
          [
            club.id, 'p1', 'Администратор', 'Предпочитает раннюю посадку за 1-й стол, часто приводит друзей.', now - 6 * DAY,
            'p2', 'Флор', 'Интересовалась серией Deepstack, попросила напоминать за день.', now - 4 * DAY,
            'p21', 'Менеджер', 'Не был больше месяца — предложить приветственный бонус на вход.', now - 2 * DAY,
          ],
        );
        await tx.query(
          'INSERT INTO player_messages (club_id,player_id,direction,channel,author,body,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7),($1,$2,$8,$4,$9,$10,$11),($1,$12,$13,$14,$15,$16,$17)',
          [
            club.id, 'p1', 'out', 'telegram', 'Бот клуба', 'Александр, напоминаем про Friday Bounty в 19:30. Забронировать место?', now - 6 * DAY,
            'in', 'Александр Волков', 'Да, запишите меня, буду к 19:20!', now - 6 * DAY + 900_000,
            'p24', 'out', 'instagram', 'Менеджер', 'Юлия, спасибо за регистрацию! Ждём на ближайшем вечернем турнире.', now - 4 * DAY,
          ],
        );

        // Демо-рассылки с воронкой и выручкой
        const b1Time = now - 6 * DAY;
        await tx.query(
          `INSERT INTO broadcasts (id,club_id,title,segment,segment_label,tournament_id,message,link_url,status,mode,sent_count,failed_count,clicks_count,rate_limit_per_sec,created_at,sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sent','demo',10,0,7,25,$9,$9)`,
          [
            'bc-friday', club.id, 'Приглашение на Friday Bounty', 'regular', 'Постоянные гости (3+ визита)', 'doyle-past-1',
            'В пятницу играем Friday Bounty! Вход 2 000 ₽, ранний стек +10%. Записывайтесь по ссылке.',
            'https://t.me/doyle_poker_bot?start=friday', b1Time,
          ],
        );
        const bc1Recipients = [
          { pid: 'p2', clicked: true, reg: 'doyle-past-1', vis: 'doyle-past-1' },
          { pid: 'p3', clicked: true, reg: 'doyle-past-1', vis: 'doyle-past-1' },
          { pid: 'p4', clicked: true, reg: 'doyle-past-1', vis: 'doyle-past-1' },
          { pid: 'p5', clicked: true, reg: 'doyle-past-1', vis: 'doyle-past-1' },
          { pid: 'p6', clicked: true, reg: 'doyle-past-1', vis: 'doyle-past-1' },
          { pid: 'p7', clicked: true, reg: 'doyle-past-1', vis: 'doyle-past-1' },
          { pid: 'p11', clicked: true, reg: 'doyle-past-1', vis: null },
          { pid: 'p8', clicked: false, reg: null, vis: null },
          { pid: 'p9', clicked: false, reg: null, vis: null },
          { pid: 'p12', clicked: false, reg: null, vis: null },
        ];
        for (const r of bc1Recipients) {
          await tx.query(
            `INSERT INTO broadcast_recipients (broadcast_id,club_id,player_id,status,clicked_at,registered_tournament_id,visited_tournament_id,sent_at)
             VALUES ('bc-friday',$1,$2,'sent',$3,$4,$5,$6)`,
            [club.id, r.pid, r.clicked ? b1Time + 3_600_000 : null, r.reg, r.vis, b1Time],
          );
        }

        const b2Time = now - 2 * DAY;
        await tx.query(
          `INSERT INTO broadcasts (id,club_id,title,segment,segment_label,tournament_id,message,link_url,status,mode,sent_count,failed_count,clicks_count,rate_limit_per_sec,created_at,sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sent','demo',4,0,2,25,$9,$9)`,
          [
            'bc-reactivate', club.id, 'Возврат неактивных гостей (14+ дн.)', 'inactive_14', 'Не приходили 14+ дней', upcoming,
            'Давно не виделись за столами! На ближайший Вечерний турнир для вас действует бесплатный кофе и ранний бонус к стеку.',
            'https://t.me/doyle_poker_bot?start=comeback', b2Time,
          ],
        );
        for (const [idx, pid] of ['p21', 'p22', 'p23', 'p24'].entries()) {
          await tx.query(
            `INSERT INTO broadcast_recipients (broadcast_id,club_id,player_id,status,clicked_at,registered_tournament_id,visited_tournament_id,sent_at)
             VALUES ('bc-reactivate',$1,$2,'sent',$3,NULL,NULL,$4)`,
            [club.id, pid, idx < 2 ? b2Time + 5_400_000 : null, b2Time],
          );
        }

        // Демо-задачи менеджеров и системные события таймлайна
        await tx.query(
          `INSERT INTO crm_tasks (club_id,player_id,kind,title,assignee,due_at,completed_at,result,created_at) VALUES
            ($1,'p21','call','Позвонить и предложить бонус на возврат','Менеджер Анна',$2,NULL,'',$6),
            ($1,'p24','call','Подтвердить запись на первый вечерний турнир','Менеджер Анна',$3,NULL,'',$6),
            ($1,'p18','follow_up','Напомнить о старте турнира за 2 часа','Администратор',$4,NULL,'',$6),
            ($1,'p22','follow_up','Узнать впечатления после первого визита','Флор Дмитрий',$5,NULL,'',$6),
            ($1,'p2','meeting','Забронировать место на Deepstack','Администратор',$7,$8,'Подтвердила участие на пятницу',$9)`,
          [
            club.id,
            now - 5 * 3_600_000, // просрочена
            now + 2 * 3_600_000, // на сегодня
            now + 3 * 3_600_000, // на сегодня
            now + 2 * DAY,       // через 2 дня
            now - 2 * DAY,
            now - DAY,
            now - 18 * 3_600_000,
            now - 3 * DAY,
          ],
        );
        await tx.query(
          `INSERT INTO crm_events (club_id,player_id,kind,actor,summary,created_at) VALUES
            ($1,'p1','stage','Система','Этап изменён: «Первый визит» → «Постоянный гость»',$2),
            ($1,'p21','stage','Менеджер Анна','Этап изменён: «Постоянный гость» → «Вернуть (спящий)»',$3),
            ($1,'p24','stage','Система','Создан новый лид из источника Instagram',$4)`,
          [club.id, now - 10 * DAY, now - 3 * DAY, now - 5 * DAY],
        );
      }
    }
  });
  await db.transaction(async tx => {
    const { rows } = await tx.query("INSERT INTO demo_imports (name) VALUES ('doyle-presets') ON CONFLICT DO NOTHING RETURNING name");
    if (!rows.length) return;
    for (const preset of doylePresets) {
      await tx.query(`INSERT INTO blind_presets (club_id,name,structure,config)
        SELECT id,$1,$2,$3 FROM clubs WHERE id='doyle' ON CONFLICT (club_id,name) DO NOTHING`,
      [preset.name, JSON.stringify(preset.structure), JSON.stringify(preset.config)]);
    }
  });
}

