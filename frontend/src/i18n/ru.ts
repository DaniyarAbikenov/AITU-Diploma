/**
 * UI strings of Financial Life Navigator (Russian). Edit texts here, not in the components.
 * Functions are used where a string depends on a value.
 */
import type { AccountKind, Obligation, TxKind } from "@/api/types";

export const ru = {
  brand: {
    name: "life navigator",
    tagline: "ВАШ ФИНАНСОВЫЙ МАРШРУТ",
    space: "ЛИЧНОЕ ПРОСТРАНСТВО",
    app: "Financial Life Navigator",
    legacy: "Основное приложение «Запас»",
    breadcrumb: "Моё пространство",
  },
  mode: {
    switchLabel: "Режим навигатора",
    demo: "Демо",
    live: "Мои данные",
    demoBadge: "ДЕМО-РЕЖИМ",
    liveBadge: "МОИ ДАННЫЕ",
    demoNote: "Демо · без реальных переводов",
    liveNote: "Ваши данные · расчёты предварительные",
    mockWarning: "Сервер не подключён (VITE_API_MODE=mock): показаны тестовые данные, а не ваши.",
  },
  tabs: {
    home: "Обзор",
    goals: "Мои цели",
    transactions: "Операции",
    calendar: "Календарь",
    forecast: "Прогноз",
    quests: "Мой прогресс",
    profile: "Профиль",
  },
  heading: {
    home: "Ваше будущее начинается сегодня",
    goals: "Большие планы. Маленькие шаги.",
    transactions: "Каждая операция на своём месте",
    calendar: "Всё важное — в одном календаре",
    forecast: "А что, если?..",
    quests: "Растите в своём темпе",
    profile: "Ваш план начинается с вас",
  },
  subheading: {
    home: "Деньги под контролем. Цели становятся ближе.",
    goals: "Копите на то, что действительно важно для вас.",
    transactions: "Доходы, расходы и переводы между вашими счетами.",
    calendar: "Планируйте платежи и встречайте месяц спокойно.",
    forecast: "Посмотрите, как решения сегодня меняют ваше завтра.",
    quests: "Полезные действия вместо гонки за баллами.",
    profile: "Настройте допущения, чтобы прогноз был ближе к вашей жизни.",
  },
  greeting: (name: string) => `ДОБРЫЙ ДЕНЬ, ${name.toUpperCase()}`,
  footer: {
    demo: "Демо на 27 ноября 2026 · Валюта KZT",
    live: (date: string) => `Данные на ${date} · Валюта KZT`,
    motto: "Маленькие шаги. Большое будущее.",
  },
  common: {
    preliminary: "предварительно",
    save: "Сохранить",
    cancel: "Отмена",
    retry: "Повторить",
    loading: "Загружаем ваши данные",
    loadError: "Не удалось загрузить данные",
    unknown: "не указано",
    confirm: "Подтвердить",
    reject: "Отклонить",
    restore: "Вернуть",
    delete: "Удалить",
    all: "Все",
    days: (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`,
  },
  auth: {
    title: "Войдите, чтобы увидеть свои данные",
    text: "Режим «Мои данные» показывает ваши счета, операции и платежи с сервера. Демо остаётся доступным без входа.",
    login: "Войти",
    backToDemo: "Открыть демо",
  },
  banks: {
    "Kaspi Bank": "Каспи Банк",
    "Halyk Bank": "Халык Банк",
    "Freedom Bank": "Фридом Банк",
    "Freedom Finance Bank": "Фридом Банк",
    Наличные: "Наличные",
  } as Record<string, string>,
  accountKind: { current: "Текущий", savings: "Накопительный", cash: "Наличные" } satisfies Record<
    AccountKind,
    string
  >,
  txKind: {
    expense: "Расход",
    income: "Доход",
    income_salary: "Доход · зарплата",
    income_other: "Доход · другое",
    transfer_own: "Перевод между своими счетами",
    transfer_third_party: "Перевод другому человеку",
  } satisfies Record<TxKind, string>,
  obligationKind: {
    credit: "Кредит",
    installment: "Рассрочка",
    rent: "Аренда",
    subscription: "Подписка",
    utility: "Коммунальные услуги",
  } satisfies Record<Obligation["kind"], string>,
  live: {
    home: {
      safeTitle: "Свободно на день",
      safeUntil: (date: string) => `до ${date} включительно`,
      safeIncome: "Горизонт — до дня перед ближайшей подтверждённой выплатой дохода.",
      safeMonthEnd: "Подтверждённых выплат дохода нет: горизонт — до конца месяца.",
      deficit: (amount: string) => `Не хватает ${amount} на платежи до конца горизонта.`,
      howTitle: "Как посчитано «свободно на день»",
      formula:
        "F(d) = деньги на текущих счетах и наличными − подтверждённые платежи по день d. Свободно на день = floor(max(0, min F(d)/d)). Цели, накопления и неподтверждённые платежи не учитываются.",
      noAccounts:
        "Нет подтверждённых текущих счетов с известным остатком, поэтому сумму не считаем.",
      noAccountsAction: "Подтвердить счета",
      noPayments:
        "Подтверждённых платежей нет: если они есть, сумма завышена. Подтвердите их в календаре.",
      reserveTitle: "Запас спокойствия",
      reserveDays: (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`,
      reserveNoExpenses:
        "Укажите обязательные расходы в профиле — без них резерв в днях не считаем.",
      reserveNoSavings: "Накопительных счетов нет или их остаток не подтверждён.",
      reserveAction: "Указать расходы",
      scoreTitle: "Финансовая устойчивость",
      scoreEmpty:
        "Недостаточно данных: нужны подтверждённые счета и операции. Индекс не показываем, чтобы не вводить в заблуждение.",
      scoreShortfall: (p: string) => `Вероятность кассового разрыва за 90 дней: ${p}`,
      capitalTitle: "Деньги на счетах",
      capitalHint: (n: number) => `Подтверждённых счетов: ${n}`,
      debtUnknown: "Остаток долга по кредитам не указан — долг не считаем нулевым.",
      recent: "Последние операции",
      noOperations: "Операций пока нет. Импортируйте выписку в основном приложении.",
      importAction: "Импорт выписки",
    },
    transactions: {
      month: "Месяц",
      bank: "Банк",
      account: "Счёт",
      kind: "Тип",
      allBanks: "Все банки",
      allAccounts: "Все счета",
      allKinds: "Все типы",
      search: "Найти операцию",
      income: "Доходы за месяц",
      expense: "Расходы за месяц",
      own: "Переводы между своими счетами",
      ownHint: "Не считаются ни доходом, ни расходом.",
      empty: "Операций за этот период нет.",
      emptyHint: "Выберите другой месяц или банк.",
      editTitle: "Тип операции",
      editHint:
        "Ваше решение сохраняется на сервере поверх импорта; исходная операция не меняется.",
      auto: (k: string) => `Определено автоматически: ${k}`,
      user: "Задано вами",
      resetAuto: "Вернуть автоматическое определение",
      saveRule: (merchant: string) =>
        `Применить ко всем операциям «${merchant}» и будущим импортам`,
      review: "Проверьте категорию",
    },
    calendar: {
      title: "Регулярные события",
      hint: "Найдены по вашим выпискам. Подтвердите реальные — только они попадают в расчёт «свободно на день». Отклонённые исключаются из прогноза.",
      pending: "Ждёт подтверждения",
      confirmed: "Подтверждено",
      rejected: "Отклонено",
      empty: "Регулярных платежей и доходов пока не найдено. Добавьте выплату дохода вручную.",
      monthly: (day: number) => `каждый месяц, ${day} число`,
      range: (lo: string, hi: string) => `от ${lo} до ${hi}`,
      addIncome: "Добавить выплату дохода",
      editIncome: "Изменить выплату",
      incomeName: "Название",
      incomeDay: "День месяца",
      incomeAmount: "Ожидаемая сумма, ₸",
      incomeMin: "Минимум, ₸ (необязательно)",
      incomeMax: "Максимум, ₸ (необязательно)",
      incomeHint:
        "Если зарплата приходит двумя частями, добавьте каждую выплату отдельно. Для осторожного плана берём минимум.",
      gridNote:
        "Показаны подтверждённые и ожидающие события. Повседневные траты в календаре не отражены.",
      showRejected: (n: number) => `Отклонённые (${n})`,
    },
    goals: {
      empty: "Целей пока нет. Добавьте свои — суммы и сроки задаёте вы.",
      suggestions: ["Магистратура", "Машина", "Квартира"],
      add: "Новая цель",
      name: "Название цели",
      target: "Нужная сумма, ₸",
      saved: "Уже накоплено, ₸",
      monthly: "Взнос в месяц, ₸",
      deadline: "Желаемый срок (месяц)",
      noMonthly: "Срок не рассчитан: укажите ежемесячный взнос.",
      eta: (m: string) => `При текущем взносе: ${m}`,
      required: (a: string) => `Чтобы успеть к сроку: ${a} в месяц`,
      onTrack: "Успеваете к сроку",
      offTrack: "К сроку не успеваете",
      deleteConfirm: (name: string) => `Удалить цель «${name}»?`,
    },
    forecast: {
      title: "Прогноз остатка на 60 дней",
      empty: "Для прогноза нужны подтверждённые счета и история операций.",
      range: "Коридор P10–P90 по Монте-Карло на ваших тратах; это оценка, а не обещание.",
    },
    quests: {
      empty:
        "Задания и XP в режиме «Мои данные» появятся позже: сейчас они хранятся только в демо.",
    },
    profile: {
      planTitle: "Параметры вашего плана",
      name: "Как к вам обращаться",
      city: "Город",
      timezone: "Часовой пояс",
      income: "Плановый доход в месяц, ₸",
      expenses: "Обязательные расходы в месяц, ₸",
      hours: "Рабочие часы в месяц",
      unknownHint: "Пустое поле означает «не указано» — это не ноль.",
      hourTitle: "Деньги — это ваше время",
      hourEmpty: "Укажите доход и рабочие часы, чтобы увидеть стоимость часа.",
      accountsTitle: "Ваши счета",
      accountsHint:
        "Остаток — это сумма на дату из шапки выписки или введённая вами, а не сумма операций.",
      noAccounts: "Счетов пока нет. Импортируйте выписку или добавьте счёт вручную.",
      notConfirmed: "Не подтверждён",
      balanceUnknown: "Остаток неизвестен",
      balanceFrom: (src: "manual" | "statement", date: string) =>
        src === "statement" ? `из выписки на ${date}` : `введено вами на ${date}`,
      setBalance: "Задать остаток",
      balance: "Остаток, ₸",
      balanceDate: "Дата остатка",
      confirmAccount: "Подтвердить счёт",
      kindRequired: "Выберите тип счёта",
      addAccount: "Добавить счёт",
      bank: "Банк или место хранения",
      accountName: "Название счёта",
      kind: "Тип счёта",
      saved: "Сохранено",
    },
  },
};

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100,
    b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export const bankName = (bank: string) => ru.banks[bank] ?? bank;
