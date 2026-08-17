// "How to write your thesis with Kwill" — the long-form guide in the Support
// Center (app/(app)/support-guide.tsx).
//
// Kept out of the i18n JSON for the same reason legal-content.ts and
// chat-guide-content.ts are: this is long-form prose rendered verbatim per
// language, not interpolated UI strings, and those files already carry ~155
// duplicate keys each. Only screen chrome (titles, buttons) lives in locales/.
//
// This guide is DIFFERENT from chat-guide-content.ts. That one answers "what can
// Kwill do" — a catalogue of capabilities. This one answers "how do I actually
// use it, and in what order" — it is built from what students really asked and
// really got stuck on, so every stage, rule and pitfall below corresponds to a
// pattern seen in real conversations. Don't merge the two.
//
// Each language is written natively, not translated: the Arabic talks about
// مباحث and مطالب and Simplified Arabic, the French about chapitres and sections
// and Times New Roman. A francophone student never reads a transliterated
// Arabic structure term.

/** One step in the build order. `prompt` is copyable; `why` explains the timing. */
export type GuideStage = { title: string; body: string; prompt: string; why: string };

/** A prompting rule, optionally illustrated by a weak/strong pair. */
export type GuideRule = { title: string; body: string; weak?: string; strong?: string };

export type PromptGroup = { heading: string; prompts: string[] };

export type Pitfall = { title: string; body: string; fix: string };

export type SupportGuide = {
  lead: string;

  orderHeading: string;
  orderLead: string;
  stages: GuideStage[];

  rulesHeading: string;
  rulesLead: string;
  rules: GuideRule[];
  weakLabel: string;
  strongLabel: string;

  promptsHeading: string;
  promptsLead: string;
  promptGroups: PromptGroup[];
  /** Shown on the copy control of every prompt. */
  copyLabel: string;
  copiedLabel: string;

  pitfallsHeading: string;
  pitfallsLead: string;
  pitfalls: Pitfall[];
  fixLabel: string;

  checklistHeading: string;
  checklistLead: string;
  checklist: string[];

  noteHeading: string;
  note: string;
};

type Lang = "en" | "fr" | "ar";

// ============================================================
// Arabic
// ============================================================
const AR: SupportGuide = {
  lead: "كويل يكتب داخل ملف مذكرتك نفسه — لا يعطيك نصًّا لتنسخه. ولهذا فإنّ الترتيب الذي تطلب به، ودقّة ما تطلبه، يصنعان الفرق بين مذكرة تخرج منسّقة من أول مرة ومذكرة تعيد إصلاحها عشر مرات.",

  orderHeading: "الترتيب الصحيح",
  orderLead: "أكثر ما يضيّع وقت الطلبة ليس سوء الطلب، بل طلب صحيح في وقت خطأ: فهرس يُبنى قبل أن تصير العناوين عناوين حقيقية، وترويسات تُضبط قبل تقسيم الأقسام. اتبع هذه المراحل بترتيبها.",
  stages: [
    {
      title: "١ — الخطة والعناوين أولًا",
      body: "ابنِ هيكل المذكرة كاملًا — الأجزاء والفصول والمباحث والمطالب — قبل كتابة كلمة واحدة من المحتوى.",
      prompt: "أنشئ هيكلًا مفصّلًا لفصول ومباحث المذكرة حول [موضوعك]، مقسَّمًا إلى جزء نظري وجزء تطبيقي، مع مقدمة عامة وخاتمة عامة.",
      why: "كل ما بعده — الفهرس، الترويسات، الصفحات الفاصلة، الترقيم — يُبنى على هذا الهيكل. تغييره لاحقًا يعني إعادة بناء كل ذلك.",
    },
    {
      title: "٢ — حوِّل العناوين إلى عناوين حقيقية",
      body: "إن استوردت ملفًا، فالغالب أنّ «عناوينه» مجرّد نصّ غليظ مكبَّر. Word لا يراها عناوين، ولن تظهر في أي فهرس. هذه أكثر مهمة طلبها الطلبة على الإطلاق.",
      prompt: "هذه المذكرة تحتوي على عناوين في شكل نصّ عادي. ابحث عنها كلها وحوّلها إلى عناوين حقيقية بمستوياتها الصحيحة: الأجزاء مستوى 1، الفصول مستوى 2، المباحث مستوى 3، المطالب مستوى 4.",
      why: "الفهرس والترويسات والترقيم كلها تقرأ العناوين الحقيقية. قبل هذه المرحلة، كلها ستخرج ناقصة.",
    },
    {
      title: "٣ — اكتب المحتوى",
      body: "فصلًا فصلًا، بل مبحثًا مبحثًا. لا تطلب «اكتب المذكرة كاملة» — النتيجة تخرج سطحية ومتكرّرة، وأنت لن تراجعها.",
      prompt: "اكتب المبحث الأول من الفصل الأول: [عنوان المبحث]، في حدود 700 كلمة، بعربية أكاديمية، مع تمهيد وخاتمة للمبحث، دون نقاط مختصرة.",
      why: "التنسيق يُطبَّق على نصّ موجود. إن نسّقت قبل الكتابة، فالمحتوى الجديد سيأتي بتنسيق مختلف وستعيد العمل مرّتين.",
    },
    {
      title: "٤ — نسّق النصّ، وكن صريحًا في العربية",
      body: "الاتجاه والمحاذاة والخط والتباعد. للعربية اطلبها صراحةً ولا تفترض أنها تلقائية.",
      prompt: "اضبط كل فقرات المذكرة: الاتجاه من اليمين إلى اليسار، المحاذاة ضبط، الخط Simplified Arabic حجم 14 للنص و16 للعناوين بالأسود، تباعد الأسطر 1.5.",
      why: "بعد اكتمال النصّ تمرّ عملية تنسيق واحدة على كل شيء، بدل عشر عمليات متفرّقة تتناقض فيما بينها.",
    },
    {
      title: "٥ — قسّم الأقسام وأضف الصفحات الفاصلة",
      body: "الصفحة الفاصلة هي التي تحمل «الفصل الأول» وحدها قبل بداية الفصل.",
      prompt: "أضف صفحة فاصلة قبل كل قسم رئيسي: المقدمة العامة، الجزء النظري، الجزء التطبيقي، الخاتمة العامة، قائمة المراجع. اجعل عنوان الصفحة الفاصلة في منتصف الصفحة تمامًا أفقيًّا وعموديًّا.",
      why: "الصفحة الفاصلة تُنشئ قسمًا جديدًا في Word، والترويسات تُبنى على الأقسام. لو ضبطت الترويسات أولًا، فإضافة فاصل بعدها ستعيد خلطها.",
    },
    {
      title: "٦ — الترويسات والتذييلات والترقيم",
      body: "هنا يقع أكثر إرباك في التطبيق كلّه، وسببه قاعدة من Word نفسه: الأقسام ترث ترويسة ما قبلها. فإذا غيّرت ترويسة الفصل الثاني تغيّر معها الثالث والرابع. الحلّ كلمة واحدة تضيفها إلى طلبك: «افصل».",
      prompt: "افصل كل قسم عن القسم الذي قبله، ثم ضع لكل قسم ترويسته الخاصة: عنوان القسم على اليمين ورقمه على اليسار، مع حافة سفلية بنية رفيعة.",
      why: "إن رأيت ترويسة قسم تتغيّر مع تغيير قسم آخر فذلك ليس عطلًا، بل قسمان لم يُفصلا بعد.",
    },
    {
      title: "٧ — الفهارس في الأخير",
      body: "فهرس المحتويات، وقائمة الأشكال، وقائمة الجداول. هذه آخر خطوة دائمًا.",
      prompt: "ولّد فهرس المحتويات من عناوين المذكرة بمستوياتها، وأضف قائمة الأشكال وقائمة الجداول، كل واحدة في صفحة مستقلّة.",
      why: "الفهرس صورة عن الهيكل لحظة توليده. كل تغيير في العناوين بعده يجعله قديمًا — فولّده حين يستقرّ كل شيء.",
    },
  ],

  rulesHeading: "كيف تكتب توجيهًا يعمل من أول مرة",
  rulesLead: "الفرق بين طلب يُنفَّذ في دور واحد وطلب يستهلك عشرة أدوار ليس ذكاء الطالب — بل هذه القواعد.",
  rules: [
    {
      title: "قل ماذا وأين وكيف في الرسالة نفسها",
      body: "أكثر ما يُبطئ العمل رسالة ناقصة: يسأل كويل، فتجيب بكلمة، فيسأل من جديد. ضع كل شيء دفعةً واحدة.",
      weak: "اكتب المقدمة",
      strong: "اكتب المقدمة العامة في مكانها من المذكرة، في حدود 500 كلمة، تتضمّن الإشكالية والفرضيات وأسباب اختيار الموضوع وأهمّيته والمنهج المتّبع.",
    },
    {
      title: "مهمّة واحدة في كل رسالة",
      body: "تعليمة واحدة واضحة أنجع من قائمة من عشر. المهام الكثيرة في رسالة واحدة تُنفَّذ جزئيًّا، وقد يتغيّر المستند تحت التعليمة الثانية بسبب الأولى. أرسل التالية بعد أن تنتهي الأولى.",
    },
    {
      title: "حدّد الموضع بالكلمات لا بالأرقام",
      body: "لن ترى في التطبيق أرقام فقرات ولا تحتاج إليها. «في المقدمة»، «في الفقرة التي تتحدث عن حجم العيّنة»، «آخر جدول في الفصل الثاني» — كلها كافية، وسيعيد إليك رابطًا إلى الموضع بالضبط.",
    },
    {
      title: "اطلب الخطة قبل التنفيذ في العمليات الكبيرة",
      body: "قبل أي إعادة هيكلة أو حذف واسع، اطلب أن يعرض عليك ما سيفعله. هذه الخطوة أنقذت طلبةً من فقدان فصل كامل.",
      strong: "اعرض عليّ أولًا ما ستغيّره بالضبط، ولا تنفّذ شيئًا قبل موافقتي.",
    },
    {
      title: "اطلب القائمة قبل الحذف",
      body: "عند التنظيف — فقرات فارغة، عناوين مكرّرة، صفحات بيضاء — اطلب الجرد أولًا، وسمِّ ما يجب استثناؤه.",
      strong: "احذف الفقرات الفارغة القابلة للحذف بأمان، واترك الفقرات المرتبطة بفواصل الصفحات والأقسام.",
    },
    {
      title: "أعطه معيارًا لا صفة",
      body: "«حسب معايير الجامعة» لا يعني شيئًا محدَّدًا، والجامعات الجزائرية تختلف. أعطه القيم، أو تصفّح القوالب إن كنت لا تعرفها.",
      weak: "طبّق معيار الجامعة",
      strong: "Simplified Arabic حجم 14 للنص و16 للعناوين، أسود، تباعد 1.5، هوامش 2.5 سم، محاذاة ضبط.",
    },
    {
      title: "صحّح بالوصف لا بالشكوى",
      body: "«لا يزال هناك المزيد» و«هذا خطأ» لا تخبره بشيء. صف ما تراه وأين. وإن كان أسهل أن تُريه، فالتقط صورة للشاشة وأرسلها — كويل يقرأ الصور.",
      weak: "لا يزال هناك المزيد",
      strong: "ما زالت هناك فقرات فارغة بين نهاية المبحث الثاني وبداية المبحث الثالث في الفصل الأول.",
    },
  ],
  weakLabel: "ضعيف",
  strongLabel: "أفضل",

  promptsHeading: "مكتبة التوجيهات",
  promptsLead: "توجيهات مصوغة على الطريقة التي تعمل. استبدل ما بين القوسين بتفاصيلك، والمس التوجيه لنسخه.",
  promptGroups: [
    {
      heading: "الموضوع والخطة",
      prompts: [
        "اقترح عليّ خمسة مواضيع لمذكرة [ماستر] في تخصّص [تخصّصك]، مع سؤال بحث مختصر لكل موضوع، وقابلة للدراسة الميدانية في الجزائر.",
        "أنشئ هيكلًا مفصّلًا لفصول ومباحث المذكرة حول [الموضوع]، مقسَّمًا إلى جزء نظري وجزء تطبيقي.",
        "اعرض لي الهيكل الكامل للمذكرة مع توضيح مستوى كل عنوان.",
        "راجع مستويات جميع العناوين وترقيمها، وصحّحها لتصبح متّسقة هرميًّا في المذكرة كلها.",
      ],
    },
    {
      heading: "كتابة المحتوى",
      prompts: [
        "اكتب المقدمة العامة في مكانها، في حدود 500 كلمة، تتضمّن الإشكالية والفرضيات وأسباب اختيار الموضوع وأهمّيته وأهدافه والمنهج المتّبع.",
        "اكتب المبحث [الأول] من الفصل [الأول]: [العنوان]، في حدود 700 كلمة، بعربية أكاديمية، مع تمهيد وخاتمة للمبحث.",
        "أضف مبحثًا مختصرًا للدراسات السابقة حول [موضوعك]، مع توثيق كل دراسة ومقارنتها بموضوع بحثي.",
        "اكتب الخاتمة العامة انطلاقًا مما ورد فعلًا في الفصول، مع الإجابة عن الإشكالية ومناقشة الفرضيات وتوصيات في الأخير.",
        "اكتب صفحة الإهداء وصفحة الشكر والعرفان، كل واحدة في صفحة مستقلّة.",
        "اكتب ملخّصًا في حدود 200 كلمة يذكر الإشكالية والمنهج وأهم النتائج، بالعربية وبالفرنسية، في صفحة مستقلّة.",
      ],
    },
    {
      heading: "تحسين ما كتبتَه أنت",
      prompts: [
        "اجعل هذه الفقرة أكثر أكاديمية دون تغيير معناها ودون زيادة طولها: [حدّد موضعها].",
        "صحّح الأخطاء اللغوية والإملائية في الفصل [الأول] دون تغيير الأفكار ولا إعادة صياغة الجمل السليمة.",
        "اختصر هذا المبحث إلى نصف طوله مع الحفاظ على كل الأفكار الأساسية.",
      ],
    },
    {
      heading: "التنسيق",
      prompts: [
        "اضبط كل فقرات المذكرة: الاتجاه من اليمين إلى اليسار، المحاذاة ضبط، الخط [Simplified Arabic] حجم [14] للنص و[16] للعناوين، تباعد الأسطر [1.5].",
        "تحقّق من اتجاه النص ومحاذاته في المحتوى المضاف حديثًا، وصحّح أي فقرة تخالف بقية المذكرة.",
        "اجعل كل عناوين الفصول والمباحث بخط غليظ، وابدأ كل فصل في صفحة جديدة.",
      ],
    },
    {
      heading: "الأقسام والترويسات والترقيم",
      prompts: [
        "أضف صفحة فاصلة قبل كل قسم رئيسي، واجعل عنوانها في منتصف الصفحة تمامًا أفقيًّا وعموديًّا.",
        "افصل كل قسم عن القسم الذي قبله، ثم ضع لكل قسم ترويسته الخاصة: عنوان القسم على اليمين ورقمه على اليسار، مع حافة سفلية بنية رفيعة.",
        "احذف ترقيم الصفحات من كل ما يسبق المقدمة العامة، وابدأ الترقيم من المقدمة برقم 1، ولا ترقّم الصفحات الفاصلة.",
        "احذف كل الترويسات والتذييلات وأعد بناءها من جديد بشكل موحّد في المذكرة كلها.",
      ],
    },
    {
      heading: "الجداول والأشكال والمعادلات",
      prompts: [
        "أدرج جدولًا يقارن بين [كذا وكذا]، بصف عناوين منسّق، مع تسمية توضيحية مرقّمة فوقه.",
        "أدرج هذه الصورة بعد الفقرة التي تتحدث عن [كذا] مباشرة، في وسط الصفحة، مع تسمية توضيحية مرقّمة تحتها.",
        "أنشئ رسمًا بيانيًّا بالأعمدة من هذه الأرقام: [أرقامك]، وضعه في [الموضع]، مع تسمية توضيحية.",
        "حوّل التسميات التوضيحية المكتوبة يدويًّا إلى تسميات حقيقية مرقّمة تلقائيًّا، ثم أضف قائمة الأشكال وقائمة الجداول.",
      ],
    },
    {
      heading: "مصادرك وملفاتك",
      prompts: [
        "اقرأ الملف الذي أرفقته، وقل لي ما الذي يمكنني استعماله منه في الفصل [الثاني].",
        "انقل الفصل النظري كاملًا من الملف المرفق إلى مذكرتي، مع الحفاظ على عناوينه ومستوياتها.",
        "انقل الرسوم البيانية والأشكال من الملف المرفق إلى الفصل التطبيقي في مذكرتي.",
      ],
    },
    {
      heading: "التنظيف والمراجعة",
      prompts: [
        "اعرض لي قائمة بكل الفقرات الفارغة والعناوين الفارغة قبل حذف أي شيء.",
        "ابحث عن العناوين المكرّرة في المذكرة، واحتفظ بواحد واحذف الباقي.",
        "راجع تجانس العناوين وترتيبها، واعرض عليّ ما تراه غير متّسق قبل تصحيحه.",
        "قارن محتوى الفصل [الأول] بما كان عليه قبل آخر تعديل، وتأكّد من عدم فقدان أي عنوان أو فقرة.",
      ],
    },
  ],
  copyLabel: "نسخ",
  copiedLabel: "نُسخ",

  pitfallsHeading: "ما يعثر فيه الطلبة",
  pitfallsLead: "ستّ عثرات تكرّرت أكثر من غيرها في الاستعمال الحقيقي، مع ما يحلّها.",
  pitfalls: [
    {
      title: "ترويسة قسم تغيّر القسم الذي بعده",
      body: "تضبط ترويسة الفصل الثاني فتتغيّر معها ترويسة الثالث. ليس عطلًا: في Word ترث الأقسام ترويسة ما قبلها حتى تُفصل.",
      fix: "«افصل هذا القسم عن القسم الذي قبله، ثم أعد تطبيق ترويسته وحدها.»",
    },
    {
      title: "الفهرس ناقص أو فارغ",
      body: "غالبًا لأن العناوين ليست عناوين حقيقية بعد، بل نصّ غليظ مكبَّر. الفهرس لا يرى إلا العناوين الحقيقية.",
      fix: "عد إلى المرحلة الثانية: حوّل العناوين إلى عناوين حقيقية، ثم أعد توليد الفهرس.",
    },
    {
      title: "حذفتَ الفقرات الفارغة ولا تزال موجودة",
      body: "يحدث حين تُطلب عدة تعديلات دفعةً واحدة: أول تعديل يغيّر مواضع ما بعده، فتصبح بقية المواضع قديمة قبل أن تُنفَّذ.",
      fix: "اطلب الجرد أولًا، ثم اطلب التنفيذ في رسالة مستقلّة. ولا ترسل طلبًا جديدًا وكويل ما زال يعمل.",
    },
    {
      title: "اختفى محتوى بعد إعادة هيكلة",
      body: "العمليات الواسعة قد تمسّ أكثر مما تتوقّع، خصوصًا حين تُطلب بصيغة عامة مثل «أعد ترتيب كل شيء».",
      fix: "افتح السجل (أيقونة الساعة أعلى المحرّر) وعد إلى النسخة السابقة، أو قل «تراجع». وفي المرة القادمة اطلب الخطة قبل التنفيذ.",
    },
    {
      title: "الصورة لا تظهر حيث طلبتَها",
      body: "«ضعها في الأخير» أو «بعد المخطط» قد تكون غامضة في مستند طويل فيه عدّة مخطّطات.",
      fix: "اذكر نصًّا قريبًا من الموضع: «أدرجها مباشرة بعد الفقرة التي تنتهي بـ[اقتباس قصير]»، ثم افتح المحرّر وتحقّق.",
    },
    {
      title: "أرقام صفحات الفهرس كلها 1 في Word",
      body: "الفهرس حقل حيّ في Word، وأرقامه تُحسب حين يعيد Word ترقيم الصفحات فعليًّا.",
      fix: "افتح الملف في Word، انقر على الفهرس بالزر الأيمن ثم «تحديث الحقل».",
    },
  ],
  fixLabel: "الحل",

  checklistHeading: "قبل التسليم",
  checklistLead: "مرّ على هذه القائمة بعد فتح الملف المصدَّر في Word، لا من داخل التطبيق.",
  checklist: [
    "صفحة الغلاف صحيحة: العنوان، اسمك، اسم المشرف، الجامعة، السنة الجامعية.",
    "الفهرس محدَّث وأرقام صفحاته صحيحة بعد تحديث الحقل في Word.",
    "ترقيم الصفحات يبدأ حيث يجب، والصفحات التمهيدية غير مرقّمة.",
    "كل فصل يبدأ في صفحة جديدة، ولا توجد صفحات بيضاء زائدة.",
    "الترويسات صحيحة في كل قسم ولا تتكرّر خطأً من قسم إلى آخر.",
    "الخط والحجم والتباعد والمحاذاة موحّدة من أول صفحة إلى آخرها.",
    "كل الجداول والأشكال لها تسميات مرقّمة، وقوائمها مطابقة لها.",
    "كل مرجع وكل رقم وكل اقتباس تحقّقتَ منه بنفسك من مصدره.",
  ],

  noteHeading: "ملاحظة أخيرة",
  note: "كويل مساعد، والمذكرة مذكرتك. راجع كل ما يكتبه قبل أن تنسبه إلى نفسك، والتزم بقواعد جامعتك بشأن استعمال الذكاء الاصطناعي — فهي تختلف من مؤسسة إلى أخرى، ومسؤولية العمل تبقى عليك وحدك.",
};

// ============================================================
// French
// ============================================================
const FR: SupportGuide = {
  lead: "Kwill écrit directement dans le fichier de votre mémoire — il ne vous donne pas du texte à copier. C'est pourquoi l'ordre dans lequel vous demandez, et la précision de vos demandes, font la différence entre un mémoire mis en forme du premier coup et un mémoire repris dix fois.",

  orderHeading: "Le bon ordre",
  orderLead: "Ce qui fait perdre le plus de temps n'est pas une mauvaise demande, mais une bonne demande au mauvais moment : une table des matières générée avant que les titres soient de vrais titres, des en-têtes réglés avant le découpage en sections. Suivez ces étapes dans l'ordre.",
  stages: [
    {
      title: "1 — Le plan et les titres d'abord",
      body: "Construisez toute la structure — parties, chapitres, sections, sous-sections — avant d'écrire une seule ligne de contenu.",
      prompt: "Crée un plan détaillé des chapitres et sections du mémoire sur [votre sujet], divisé en une partie théorique et une partie pratique, avec une introduction générale et une conclusion générale.",
      why: "Tout le reste — table des matières, en-têtes, pages de garde, pagination — se construit sur cette structure. La changer ensuite oblige à tout refaire.",
    },
    {
      title: "2 — Convertissez les titres en vrais titres",
      body: "Si vous avez importé un fichier, ses « titres » sont probablement du texte en gras agrandi. Word ne les reconnaît pas comme des titres et ils n'apparaîtront dans aucune table des matières. C'est la demande la plus fréquente des étudiants.",
      prompt: "Ce mémoire contient des titres sous forme de texte normal. Trouve-les tous et convertis-les en véritables styles de titre au bon niveau : parties niveau 1, chapitres niveau 2, sections niveau 3, sous-sections niveau 4.",
      why: "La table des matières, les en-têtes et la numérotation lisent tous les vrais titres. Avant cette étape, tout sortira incomplet.",
    },
    {
      title: "3 — Rédigez le contenu",
      body: "Chapitre par chapitre, section par section. Ne demandez pas « écris tout le mémoire » : le résultat est superficiel et répétitif, et vous ne le relirez pas.",
      prompt: "Rédige la première section du chapitre 1 : [titre de la section], en 700 mots environ, dans un français académique, avec une introduction et une conclusion de section, sans listes à puces.",
      why: "La mise en forme s'applique à du texte existant. Si vous formatez avant d'écrire, le nouveau contenu arrivera avec un autre format et vous referez le travail.",
    },
    {
      title: "4 — Mettez en forme le texte",
      body: "Alignement, police, interligne. Demandez des valeurs précises plutôt qu'une intention générale.",
      prompt: "Applique à tous les paragraphes du mémoire : justifié, police Times New Roman 12 pour le texte et 14 pour les titres en noir, interligne 1,5.",
      why: "Une fois le texte terminé, une seule passe de mise en forme couvre tout, au lieu de dix opérations dispersées qui se contredisent.",
    },
    {
      title: "5 — Découpez les sections et ajoutez les pages de garde",
      body: "La page de garde est celle qui porte « Chapitre 1 » seule, avant le début du chapitre.",
      prompt: "Ajoute une page de garde avant chaque grande partie : introduction générale, partie théorique, partie pratique, conclusion générale, bibliographie. Centre le titre de la page de garde parfaitement, horizontalement et verticalement.",
      why: "Une page de garde crée une nouvelle section dans Word, et les en-têtes se construisent sur les sections. Régler les en-têtes d'abord puis ajouter une page de garde remélange tout.",
    },
    {
      title: "6 — En-têtes, pieds de page et pagination",
      body: "C'est ici que se concentre la confusion, à cause d'une règle de Word : une section hérite de l'en-tête de la précédente. Changez l'en-tête du chapitre 2 et le 3 et le 4 changent aussi. La solution tient en un mot à ajouter à votre demande : « dissocie ».",
      prompt: "Dissocie chaque section de la précédente, puis donne à chacune son propre en-tête : le titre de la section à gauche et son numéro à droite, avec un mince filet brun en dessous.",
      why: "Si un en-tête change en même temps qu'un autre, ce n'est pas un bug : ce sont deux sections encore liées.",
    },
    {
      title: "7 — Les index en dernier",
      body: "Table des matières, liste des figures, liste des tableaux. Toujours en dernier.",
      prompt: "Génère la table des matières à partir des titres du mémoire avec leurs niveaux, et ajoute la liste des figures et la liste des tableaux, chacune sur sa propre page.",
      why: "La table des matières est un instantané de la structure. Toute modification de titre après coup la périme — générez-la quand tout est stable.",
    },
  ],

  rulesHeading: "Écrire une demande qui marche du premier coup",
  rulesLead: "La différence entre une demande traitée en un tour et une demande qui en consomme dix, ce ne sont pas vos compétences — ce sont ces règles.",
  rules: [
    {
      title: "Dites quoi, où et comment dans le même message",
      body: "Ce qui ralentit le plus, c'est un message incomplet : Kwill demande, vous répondez d'un mot, il redemande. Mettez tout d'un coup.",
      weak: "Écris l'introduction",
      strong: "Rédige l'introduction générale à sa place dans le mémoire, en 500 mots environ, avec la problématique, les hypothèses, les raisons du choix du sujet, son intérêt et la méthodologie suivie.",
    },
    {
      title: "Une seule tâche par message",
      body: "Une consigne claire vaut mieux qu'une liste de dix. Plusieurs tâches dans un message ne sont exécutées qu'en partie, et le document peut changer sous la deuxième consigne à cause de la première. Envoyez la suivante une fois la première terminée.",
    },
    {
      title: "Situez avec des mots, pas des numéros",
      body: "Vous ne verrez jamais de numéros de paragraphe dans l'application et vous n'en avez pas besoin. « Dans l'introduction », « le paragraphe qui parle de la taille de l'échantillon », « le dernier tableau du chapitre 2 » suffisent — Kwill vous renverra un lien vers l'endroit exact.",
    },
    {
      title: "Demandez le plan avant l'exécution",
      body: "Avant toute restructuration ou suppression large, faites-lui présenter ce qu'il va faire. Cette étape a évité à des étudiants de perdre un chapitre entier.",
      strong: "Montre-moi d'abord exactement ce que tu vas changer, et n'exécute rien avant mon accord.",
    },
    {
      title: "Demandez la liste avant la suppression",
      body: "Pour tout nettoyage — paragraphes vides, titres en double, pages blanches — demandez l'inventaire d'abord, et nommez ce qu'il faut épargner.",
      strong: "Supprime les paragraphes vides qui peuvent l'être sans risque, et laisse ceux liés aux sauts de page et de section.",
    },
    {
      title: "Donnez une norme, pas un adjectif",
      body: "« Selon les normes de l'université » ne veut rien dire de précis, et les universités algériennes diffèrent. Donnez les valeurs, ou parcourez les modèles si vous ne les connaissez pas.",
      weak: "Applique les normes de l'université",
      strong: "Times New Roman 12 pour le texte et 14 pour les titres, noir, interligne 1,5, marges 2,5 cm, justifié.",
    },
    {
      title: "Corrigez en décrivant, pas en vous plaignant",
      body: "« Il en reste encore » ou « c'est faux » ne lui apprennent rien. Décrivez ce que vous voyez et où. Et si montrer est plus simple, envoyez une capture d'écran — Kwill lit les images.",
      weak: "Il en reste encore",
      strong: "Il reste des paragraphes vides entre la fin de la section 2 et le début de la section 3 du chapitre 1.",
    },
  ],
  weakLabel: "Faible",
  strongLabel: "Mieux",

  promptsHeading: "Bibliothèque de demandes",
  promptsLead: "Des demandes formulées comme il faut. Remplacez ce qui est entre crochets par vos détails, touchez une demande pour la copier.",
  promptGroups: [
    {
      heading: "Sujet et plan",
      prompts: [
        "Propose-moi cinq sujets de mémoire de [master] en [votre spécialité], avec une question de recherche courte pour chacun, réalisables sur le terrain en Algérie.",
        "Crée un plan détaillé des chapitres et sections du mémoire sur [le sujet], divisé en partie théorique et partie pratique.",
        "Montre-moi la structure complète du mémoire en précisant le niveau de chaque titre.",
        "Révise les niveaux et la numérotation de tous les titres, et corrige-les pour une hiérarchie cohérente dans tout le mémoire.",
      ],
    },
    {
      heading: "Rédaction",
      prompts: [
        "Rédige l'introduction générale à sa place, en 500 mots environ, avec la problématique, les hypothèses, les raisons du choix du sujet, son intérêt, ses objectifs et la méthodologie.",
        "Rédige la section [1] du chapitre [1] : [le titre], en 700 mots environ, en français académique, avec introduction et conclusion de section.",
        "Ajoute une courte section sur les études antérieures concernant [votre sujet], en référençant chaque étude et en la comparant à mon travail.",
        "Rédige la conclusion générale à partir de ce qui figure réellement dans les chapitres, en répondant à la problématique, en discutant les hypothèses et en terminant par des recommandations.",
        "Rédige la page de dédicace et la page de remerciements, chacune sur sa propre page.",
        "Rédige un résumé de 200 mots environ avec la problématique, la méthode et les principaux résultats, en français et en arabe, sur une page séparée.",
      ],
    },
    {
      heading: "Améliorer ce que vous avez écrit",
      prompts: [
        "Rends ce paragraphe plus académique sans changer son sens ni l'allonger : [situez-le].",
        "Corrige les fautes de langue et d'orthographe du chapitre [1] sans modifier les idées ni reformuler les phrases correctes.",
        "Réduis cette section de moitié en conservant toutes les idées essentielles.",
      ],
    },
    {
      heading: "Mise en forme",
      prompts: [
        "Applique à tous les paragraphes : justifié, police [Times New Roman] [12] pour le texte et [14] pour les titres, interligne [1,5].",
        "Vérifie l'alignement et l'interligne du contenu récemment ajouté, et corrige tout paragraphe qui diffère du reste.",
        "Mets tous les titres de chapitres et de sections en gras, et fais commencer chaque chapitre sur une nouvelle page.",
      ],
    },
    {
      heading: "Sections, en-têtes et pagination",
      prompts: [
        "Ajoute une page de garde avant chaque grande partie, avec son titre parfaitement centré horizontalement et verticalement.",
        "Dissocie chaque section de la précédente, puis donne à chacune son propre en-tête : titre à gauche, numéro à droite, avec un mince filet brun.",
        "Supprime la pagination de tout ce qui précède l'introduction générale, commence la numérotation à 1 à l'introduction, et ne numérote pas les pages de garde.",
        "Supprime tous les en-têtes et pieds de page et reconstruis-les de façon uniforme dans tout le mémoire.",
      ],
    },
    {
      heading: "Tableaux, figures et équations",
      prompts: [
        "Insère un tableau comparant [ceci et cela], avec une ligne d'en-tête mise en forme et une légende numérotée au-dessus.",
        "Insère cette image juste après le paragraphe qui parle de [sujet], centrée sur la page, avec une légende numérotée en dessous.",
        "Crée un graphique en barres à partir de ces chiffres : [vos chiffres], place-le [où], avec une légende.",
        "Convertis les légendes saisies à la main en véritables légendes numérotées automatiquement, puis ajoute la liste des figures et la liste des tableaux.",
      ],
    },
    {
      heading: "Vos sources et fichiers",
      prompts: [
        "Lis le fichier que je viens de joindre et dis-moi ce que je peux en utiliser pour le chapitre [2].",
        "Transfère tout le chapitre théorique du fichier joint vers mon mémoire, en conservant ses titres et leurs niveaux.",
        "Transfère les graphiques et figures du fichier joint vers la partie pratique de mon mémoire.",
      ],
    },
    {
      heading: "Nettoyage et relecture",
      prompts: [
        "Montre-moi la liste de tous les paragraphes vides et titres vides avant de supprimer quoi que ce soit.",
        "Cherche les titres en double dans le mémoire, garde-en un et supprime les autres.",
        "Vérifie la cohérence et l'ordre des titres, et montre-moi ce qui te semble incohérent avant de corriger.",
        "Compare le contenu du chapitre [1] à son état avant la dernière modification et vérifie qu'aucun titre ni paragraphe n'a disparu.",
      ],
    },
  ],
  copyLabel: "Copier",
  copiedLabel: "Copié",

  pitfallsHeading: "Là où les étudiants butent",
  pitfallsLead: "Six obstacles revenus plus souvent que les autres à l'usage, et ce qui les règle.",
  pitfalls: [
    {
      title: "Un en-tête de section en change une autre",
      body: "Vous réglez l'en-tête du chapitre 2 et celui du 3 change aussi. Ce n'est pas un bug : dans Word, une section hérite de l'en-tête de la précédente tant qu'elle n'en est pas dissociée.",
      fix: "« Dissocie cette section de la précédente, puis réapplique son en-tête à elle seule. »",
    },
    {
      title: "La table des matières est vide ou incomplète",
      body: "Le plus souvent parce que les titres ne sont pas encore de vrais titres, seulement du gras agrandi. La table des matières ne voit que les vrais titres.",
      fix: "Revenez à l'étape 2 : convertissez les titres, puis régénérez la table des matières.",
    },
    {
      title: "Les paragraphes vides supprimés sont toujours là",
      body: "Cela arrive quand plusieurs modifications sont demandées d'un coup : la première déplace tout ce qui suit, et les cibles suivantes sont périmées avant d'être traitées.",
      fix: "Demandez l'inventaire d'abord, puis l'exécution dans un message séparé. Et n'envoyez pas de nouvelle demande pendant que Kwill travaille.",
    },
    {
      title: "Du contenu a disparu après une restructuration",
      body: "Les opérations larges touchent parfois plus que prévu, surtout demandées vaguement comme « réorganise tout ».",
      fix: "Ouvrez l'historique (l'horloge en haut de l'éditeur) et revenez à la version précédente, ou dites « annule ». La prochaine fois, demandez le plan d'abord.",
    },
    {
      title: "L'image n'apparaît pas où vous l'aviez demandée",
      body: "« Mets-la à la fin » ou « après le graphique » peut être ambigu dans un long document qui contient plusieurs graphiques.",
      fix: "Citez un texte proche : « insère-la juste après le paragraphe qui finit par [courte citation] », puis vérifiez dans l'éditeur.",
    },
    {
      title: "Les numéros de page de la table des matières affichent tous 1",
      body: "La table des matières est un champ vivant dans Word, et ses numéros se calculent quand Word repagine réellement.",
      fix: "Ouvrez le fichier dans Word, clic droit sur la table des matières puis « Mettre à jour les champs ».",
    },
  ],
  fixLabel: "Solution",

  checklistHeading: "Avant de rendre",
  checklistLead: "Parcourez cette liste après avoir ouvert le fichier exporté dans Word, pas depuis l'application.",
  checklist: [
    "La page de couverture est correcte : titre, votre nom, l'encadreur, l'université, l'année universitaire.",
    "La table des matières est à jour et ses numéros de page sont corrects après mise à jour des champs dans Word.",
    "La pagination commence au bon endroit et les pages liminaires ne sont pas numérotées.",
    "Chaque chapitre commence sur une nouvelle page et il n'y a pas de pages blanches en trop.",
    "Les en-têtes sont corrects dans chaque section et ne se répètent pas par erreur d'une section à l'autre.",
    "Police, taille, interligne et alignement sont uniformes de la première à la dernière page.",
    "Tous les tableaux et figures ont une légende numérotée, et leurs listes leur correspondent.",
    "Chaque référence, chaque chiffre et chaque citation a été vérifié par vous à sa source.",
  ],

  noteHeading: "Dernière remarque",
  note: "Kwill est un assistant, et le mémoire est le vôtre. Relisez tout ce qu'il écrit avant de vous l'attribuer, et respectez les règles de votre université sur l'usage de l'intelligence artificielle — elles diffèrent d'un établissement à l'autre, et la responsabilité du travail reste la vôtre.",
};

// ============================================================
// English
// ============================================================
const EN: SupportGuide = {
  lead: "Kwill writes inside your thesis file itself — it doesn't hand you text to copy. That's why the order you ask in, and how precisely you ask, decide whether your thesis comes out formatted the first time or gets fixed ten times over.",

  orderHeading: "The right order",
  orderLead: "What costs students the most time isn't a bad request — it's a good request at the wrong moment: a table of contents built before the headings are real headings, page headers set before the document is split into sections. Follow these stages in order.",
  stages: [
    {
      title: "1 — Plan and headings first",
      body: "Build the whole structure — parts, chapters, sections, subsections — before writing a single line of content.",
      prompt: "Create a detailed structure of chapters and sections for the thesis on [your topic], split into a theoretical part and a practical part, with a general introduction and a general conclusion.",
      why: "Everything after it — contents, headers, divider pages, page numbers — is built on this structure. Changing it later means rebuilding all of that.",
    },
    {
      title: "2 — Turn headings into real headings",
      body: "If you imported a file, its \"headings\" are probably just enlarged bold text. Word doesn't see those as headings, and they won't appear in any table of contents. This is the single most requested job.",
      prompt: "This thesis has headings that are only normal text. Find all of them and convert them into real headings at the correct levels: parts level 1, chapters level 2, sections level 3, subsections level 4.",
      why: "Contents, headers and numbering all read real headings. Before this stage, every one of them comes out incomplete.",
    },
    {
      title: "3 — Write the content",
      body: "Chapter by chapter, section by section. Don't ask it to \"write the whole thesis\" — the result is shallow and repetitive, and you won't review it.",
      prompt: "Write section 1 of chapter 1: [section title], around 700 words, in academic English, with a short opening and closing for the section, no bullet points.",
      why: "Formatting applies to text that exists. Format before writing and the new content arrives in a different format, so you do the work twice.",
    },
    {
      title: "4 — Format the text",
      body: "Alignment, font, spacing. Give exact values rather than a general intention.",
      prompt: "Apply to every paragraph in the thesis: justified, Times New Roman 12 for body and 14 for headings in black, line spacing 1.5.",
      why: "Once the text is complete, one formatting pass covers everything, instead of ten scattered ones that contradict each other.",
    },
    {
      title: "5 — Split the sections and add divider pages",
      body: "A divider page is the one carrying \"Chapter 1\" alone, before the chapter starts.",
      prompt: "Add a divider page before each major part: general introduction, theoretical part, practical part, general conclusion, bibliography. Centre the divider title perfectly, horizontally and vertically.",
      why: "A divider page creates a new Word section, and headers are built on sections. Set headers first and adding a divider afterwards reshuffles them.",
    },
    {
      title: "6 — Headers, footers and page numbers",
      body: "This is where most of the confusion lives, and the cause is a Word rule: a section inherits the header of the one before it. Change chapter 2's header and 3 and 4 change with it. The fix is one word added to your request: \"unlink\".",
      prompt: "Unlink every section from the one before it, then give each its own header: section title on the left and its number on the right, with a thin brown bottom border.",
      why: "If one section's header changes when you edit another, that isn't a fault — those two sections are still linked.",
    },
    {
      title: "7 — Indexes last",
      body: "Table of contents, list of figures, list of tables. Always last.",
      prompt: "Generate the table of contents from the thesis headings with their levels, and add a list of figures and a list of tables, each on its own page.",
      why: "The contents page is a snapshot of the structure. Any heading change afterwards makes it stale — generate it once everything has settled.",
    },
  ],

  rulesHeading: "Writing a request that works first time",
  rulesLead: "The difference between a request handled in one turn and one that burns ten isn't your skill — it's these rules.",
  rules: [
    {
      title: "Say what, where and how in the same message",
      body: "The biggest time sink is an incomplete message: Kwill asks, you answer with one word, it asks again. Put it all in at once.",
      weak: "Write the introduction",
      strong: "Write the general introduction in its place in the thesis, around 500 words, covering the research problem, the hypotheses, why the topic was chosen, its significance and the methodology used.",
    },
    {
      title: "One task per message",
      body: "One clear instruction beats a list of ten. Several tasks in one message get done partially, and the document can shift under the second instruction because of the first. Send the next one after the first finishes.",
    },
    {
      title: "Point with words, not numbers",
      body: "You'll never see paragraph numbers in the app and you don't need them. \"In the introduction\", \"the paragraph about sample size\", \"the last table in chapter 2\" are all enough — and it will hand you back a link to the exact spot.",
    },
    {
      title: "Ask for the plan before big operations",
      body: "Before any restructuring or wide deletion, have it show you what it intends to do. This step has saved students from losing a whole chapter.",
      strong: "Show me exactly what you're going to change first, and don't execute anything before I approve.",
    },
    {
      title: "Ask for the list before the delete",
      body: "For any cleanup — empty paragraphs, duplicate headings, blank pages — ask for the inventory first, and name what must be spared.",
      strong: "Delete the empty paragraphs that are safe to remove, and leave the ones tied to page and section breaks.",
    },
    {
      title: "Give it a standard, not an adjective",
      body: "\"University standards\" means nothing specific, and Algerian universities differ. Give the values, or browse the templates if you don't know them.",
      weak: "Apply the university standard",
      strong: "Times New Roman 12 for body and 14 for headings, black, line spacing 1.5, margins 2.5 cm, justified.",
    },
    {
      title: "Correct by describing, not complaining",
      body: "\"There are still more\" and \"this is wrong\" tell it nothing. Describe what you see and where. And if showing is easier, send a screenshot — Kwill reads images.",
      weak: "There are still more",
      strong: "There are still empty paragraphs between the end of section 2 and the start of section 3 in chapter 1.",
    },
  ],
  weakLabel: "Weak",
  strongLabel: "Better",

  promptsHeading: "Prompt library",
  promptsLead: "Requests phrased the way that works. Replace what's in brackets with your details, tap a prompt to copy it.",
  promptGroups: [
    {
      heading: "Topic and plan",
      prompts: [
        "Suggest five [master's] thesis topics in [your field], each with a short research question, feasible for fieldwork in Algeria.",
        "Create a detailed structure of chapters and sections for the thesis on [topic], split into a theoretical and a practical part.",
        "Show me the full structure of the thesis with the level of every heading.",
        "Review the levels and numbering of all headings and correct them into a consistent hierarchy across the whole thesis.",
      ],
    },
    {
      heading: "Writing content",
      prompts: [
        "Write the general introduction in its place, around 500 words, covering the research problem, hypotheses, why the topic was chosen, its significance, its objectives and the methodology.",
        "Write section [1] of chapter [1]: [the title], around 700 words, in academic English, with a short opening and closing for the section.",
        "Add a short section on previous studies about [your topic], referencing each study and comparing it to my research.",
        "Write the general conclusion from what the chapters actually say, answering the research problem, discussing the hypotheses, and ending with recommendations.",
        "Write the dedication page and the acknowledgements page, each on its own page.",
        "Write a 200-word abstract covering the problem, method and main findings, in English and in French, on its own page.",
      ],
    },
    {
      heading: "Improving what you wrote",
      prompts: [
        "Make this paragraph more academic without changing its meaning or making it longer: [point to it].",
        "Fix the language and spelling mistakes in chapter [1] without changing the ideas or rewriting correct sentences.",
        "Cut this section to half its length while keeping every essential idea.",
      ],
    },
    {
      heading: "Formatting",
      prompts: [
        "Apply to every paragraph: justified, [Times New Roman] [12] for body and [14] for headings, line spacing [1.5].",
        "Check the alignment and spacing of the recently added content, and fix any paragraph that differs from the rest.",
        "Make all chapter and section headings bold, and start every chapter on a new page.",
      ],
    },
    {
      heading: "Sections, headers and numbering",
      prompts: [
        "Add a divider page before every major part, with its title perfectly centred horizontally and vertically.",
        "Unlink each section from the previous one, then give each its own header: title on the left, number on the right, with a thin brown bottom border.",
        "Remove page numbers from everything before the general introduction, start numbering at 1 from the introduction, and don't number the divider pages.",
        "Remove all headers and footers and rebuild them uniformly across the whole thesis.",
      ],
    },
    {
      heading: "Tables, figures and equations",
      prompts: [
        "Insert a table comparing [this and that], with a formatted header row and a numbered caption above it.",
        "Insert this image right after the paragraph about [topic], centred on the page, with a numbered caption below it.",
        "Build a bar chart from these numbers: [your numbers], place it [where], with a caption.",
        "Convert the hand-typed captions into real auto-numbered captions, then add a list of figures and a list of tables.",
      ],
    },
    {
      heading: "Your sources and files",
      prompts: [
        "Read the file I just attached and tell me what I can use from it in chapter [2].",
        "Move the entire theoretical chapter from the attached file into my thesis, keeping its headings and their levels.",
        "Move the charts and figures from the attached file into the practical chapter of my thesis.",
      ],
    },
    {
      heading: "Cleanup and review",
      prompts: [
        "Show me a list of every empty paragraph and empty heading before deleting anything.",
        "Find duplicate headings in the thesis, keep one and delete the rest.",
        "Review the consistency and order of the headings, and show me what looks inconsistent before fixing it.",
        "Compare chapter [1] to how it was before the last edit and confirm no heading or paragraph was lost.",
      ],
    },
  ],
  copyLabel: "Copy",
  copiedLabel: "Copied",

  pitfallsHeading: "Where students get stuck",
  pitfallsLead: "Six obstacles that came up more than any others in real use, and what clears them.",
  pitfalls: [
    {
      title: "One section's header changes another",
      body: "You set chapter 2's header and chapter 3's changes too. Not a bug: in Word a section inherits the header of the one before it until they're unlinked.",
      fix: "\"Unlink this section from the previous one, then reapply its header on its own.\"",
    },
    {
      title: "The table of contents is empty or incomplete",
      body: "Usually because the headings aren't real headings yet, just enlarged bold text. The contents page only sees real headings.",
      fix: "Go back to stage 2: convert the headings, then regenerate the table of contents.",
    },
    {
      title: "You deleted the empty paragraphs and they're still there",
      body: "This happens when several edits are asked for at once: the first shifts everything after it, so the remaining targets are stale before they're processed.",
      fix: "Ask for the inventory first, then the deletion in its own message. And don't send a new request while Kwill is still working.",
    },
    {
      title: "Content disappeared after a restructure",
      body: "Wide operations sometimes touch more than expected, especially when asked for vaguely as \"reorganise everything\".",
      fix: "Open History (the clock at the top of the editor) and go back to the previous version, or say \"undo\". Next time, ask for the plan first.",
    },
    {
      title: "The image isn't where you asked for it",
      body: "\"Put it at the end\" or \"after the chart\" can be ambiguous in a long document with several charts.",
      fix: "Quote nearby text: \"insert it right after the paragraph ending with [short quote]\", then check in the editor.",
    },
    {
      title: "Every page number in the contents shows 1",
      body: "The table of contents is a live field in Word, and its numbers are computed when Word actually repaginates.",
      fix: "Open the file in Word, right-click the table of contents and choose \"Update field\".",
    },
  ],
  fixLabel: "Fix",

  checklistHeading: "Before you submit",
  checklistLead: "Go through this after opening the exported file in Word — not from inside the app.",
  checklist: [
    "The cover page is right: title, your name, supervisor, university, academic year.",
    "The table of contents is up to date and its page numbers are correct after updating the field in Word.",
    "Page numbering starts where it should, and the front matter isn't numbered.",
    "Every chapter starts on a new page, and there are no extra blank pages.",
    "Headers are correct in each section and don't repeat wrongly from one section to the next.",
    "Font, size, spacing and alignment are uniform from the first page to the last.",
    "Every table and figure has a numbered caption, and the lists match them.",
    "Every reference, every number and every quotation has been checked by you at its source.",
  ],

  noteHeading: "One last thing",
  note: "Kwill is an assistant, and the thesis is yours. Review everything it writes before putting your name to it, and follow your university's rules on using AI — they differ between institutions, and responsibility for the work stays with you.",
};

const GUIDES: Record<Lang, SupportGuide> = { en: EN, fr: FR, ar: AR };

/** The guide in the reader's language; anything unrecognised falls back to
 *  French, which is what getStoredLanguage() defaults to. */
export function getSupportGuide(lang: string): SupportGuide {
  const key = (lang || "").slice(0, 2).toLowerCase() as Lang;
  return GUIDES[key] ?? GUIDES.fr;
}
