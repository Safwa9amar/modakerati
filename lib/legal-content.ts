// Static legal copy for the in-app Terms of Service and Privacy Policy screens.
// Kept out of the i18n JSON because it is long-form prose (not interpolated UI
// strings) and is rendered verbatim per language. Each document is a list of
// titled sections; the screen renders the heading + paragraphs in order.

export type LegalSection = { heading: string; body: string[] };
export type LegalDoc = {
  /** Human-readable "last updated" date, already localized. */
  updated: string;
  intro: string;
  sections: LegalSection[];
};

type Lang = "en" | "fr" | "ar";

// ============================================================
// Terms of Service
// ============================================================
export const TERMS: Record<Lang, LegalDoc> = {
  en: {
    updated: "Last updated: June 2026",
    intro:
      "Welcome to Modakerati. By creating an account or using the app you agree to these Terms of Service. Please read them carefully.",
    sections: [
      {
        heading: "1. The service",
        body: [
          "Modakerati is an AI-assisted writing tool that helps students structure, draft and format academic theses and dissertations. It provides suggestions, formatting and document tools; it does not write your thesis for you or guarantee any academic outcome.",
        ],
      },
      {
        heading: "2. Your account",
        body: [
          "You must provide accurate information when registering and keep your login credentials secure. You are responsible for all activity that happens under your account.",
          "You must be enrolled at, or affiliated with, an academic institution and old enough to form a binding contract in your country.",
        ],
      },
      {
        heading: "3. Academic integrity",
        body: [
          "You are solely responsible for the work you submit to your institution. AI-generated suggestions are drafts that you must review, verify and adapt.",
          "You agree to follow your university's rules on plagiarism, citation and the permitted use of AI tools. Modakerati is a writing aid, not a substitute for your own scholarship.",
        ],
      },
      {
        heading: "4. Your content",
        body: [
          "You keep ownership of the documents, sources and text you create or upload. You grant us a limited licence to store and process that content only to provide the service to you.",
          "You must have the right to upload any source material you add, and you must not upload unlawful or infringing content.",
        ],
      },
      {
        heading: "5. Acceptable use",
        body: [
          "Do not misuse the service, attempt to disrupt it, reverse-engineer it, or use it to produce unlawful, harmful or fraudulent material.",
        ],
      },
      {
        heading: "6. Subscriptions and payments",
        body: [
          "Some features require a paid subscription. Prices and plan limits are shown in the app before you pay. Subscriptions and their renewal terms are governed by the store or payment provider you purchase through.",
        ],
      },
      {
        heading: "7. Availability and changes",
        body: [
          "We work to keep the service available but provide it 'as is', without warranties. We may update, suspend or discontinue features, and may amend these Terms; continued use after changes means you accept them.",
        ],
      },
      {
        heading: "8. Account deletion",
        body: [
          "You may delete your account at any time from Settings. Deletion is permanent and removes your profile and associated data, as described in the Privacy Policy.",
        ],
      },
      {
        heading: "9. Contact",
        body: [
          "For any question about these Terms, contact us at support@modakerati.app.",
        ],
      },
    ],
  },
  fr: {
    updated: "Dernière mise à jour : juin 2026",
    intro:
      "Bienvenue sur Modakerati. En créant un compte ou en utilisant l'application, vous acceptez les présentes Conditions d'utilisation. Veuillez les lire attentivement.",
    sections: [
      {
        heading: "1. Le service",
        body: [
          "Modakerati est un outil de rédaction assistée par IA qui aide les étudiants à structurer, rédiger et mettre en forme des mémoires et des thèses. Il fournit des suggestions et des outils de mise en forme ; il ne rédige pas votre travail à votre place et ne garantit aucun résultat académique.",
        ],
      },
      {
        heading: "2. Votre compte",
        body: [
          "Vous devez fournir des informations exactes lors de l'inscription et protéger vos identifiants. Vous êtes responsable de toute activité réalisée depuis votre compte.",
          "Vous devez être inscrit ou rattaché à un établissement d'enseignement et avoir l'âge requis pour conclure un contrat dans votre pays.",
        ],
      },
      {
        heading: "3. Intégrité académique",
        body: [
          "Vous êtes seul responsable du travail que vous soumettez à votre établissement. Les suggestions générées par l'IA sont des brouillons que vous devez relire, vérifier et adapter.",
          "Vous vous engagez à respecter les règles de votre université concernant le plagiat, la citation et l'usage autorisé des outils d'IA. Modakerati est une aide à la rédaction, non un substitut à votre propre travail.",
        ],
      },
      {
        heading: "4. Vos contenus",
        body: [
          "Vous conservez la propriété des documents, sources et textes que vous créez ou importez. Vous nous accordez une licence limitée pour stocker et traiter ces contenus uniquement afin de vous fournir le service.",
          "Vous devez détenir les droits sur toute source que vous importez et ne pas importer de contenu illicite ou contrefaisant.",
        ],
      },
      {
        heading: "5. Usage acceptable",
        body: [
          "N'utilisez pas le service de manière abusive, ne tentez pas de le perturber, de le décompiler, ni de l'utiliser pour produire des contenus illicites, nuisibles ou frauduleux.",
        ],
      },
      {
        heading: "6. Abonnements et paiements",
        body: [
          "Certaines fonctionnalités nécessitent un abonnement payant. Les prix et les limites des offres sont affichés dans l'application avant le paiement. Les abonnements et leur renouvellement sont régis par la plateforme ou le prestataire de paiement utilisé.",
        ],
      },
      {
        heading: "7. Disponibilité et modifications",
        body: [
          "Nous nous efforçons de maintenir le service disponible mais le fournissons « en l'état », sans garantie. Nous pouvons mettre à jour, suspendre ou interrompre des fonctionnalités et modifier ces Conditions ; toute utilisation après modification vaut acceptation.",
        ],
      },
      {
        heading: "8. Suppression du compte",
        body: [
          "Vous pouvez supprimer votre compte à tout moment depuis les Réglages. La suppression est définitive et efface votre profil et les données associées, comme décrit dans la Politique de confidentialité.",
        ],
      },
      {
        heading: "9. Contact",
        body: [
          "Pour toute question sur ces Conditions, contactez-nous à support@modakerati.app.",
        ],
      },
    ],
  },
  ar: {
    updated: "آخر تحديث: جوان 2026",
    intro:
      "مرحبًا بك في مذكّراتي. بإنشائك حسابًا أو باستخدامك التطبيق فإنك توافق على شروط الاستخدام هذه. يُرجى قراءتها بعناية.",
    sections: [
      {
        heading: "١. الخدمة",
        body: [
          "مذكّراتي أداة كتابة مدعومة بالذكاء الاصطناعي تساعد الطلبة على هيكلة المذكرات والأطروحات وصياغتها وتنسيقها. تقدّم الأداة اقتراحات وأدوات تنسيق، لكنها لا تكتب عملك نيابةً عنك ولا تضمن أي نتيجة أكاديمية.",
        ],
      },
      {
        heading: "٢. حسابك",
        body: [
          "يجب تقديم معلومات صحيحة عند التسجيل والحفاظ على سرية بيانات الدخول. أنت مسؤول عن كل نشاط يتم عبر حسابك.",
          "يجب أن تكون مسجَّلًا في مؤسسة تعليمية أو منتسبًا إليها، وأن تكون في السن القانونية لإبرام عقد في بلدك.",
        ],
      },
      {
        heading: "٣. النزاهة الأكاديمية",
        body: [
          "أنت وحدك المسؤول عن العمل الذي تقدّمه إلى مؤسستك. الاقتراحات المولَّدة بالذكاء الاصطناعي هي مسودّات يجب مراجعتها والتحقق منها وتكييفها.",
          "تلتزم باتباع قواعد جامعتك بشأن الانتحال والاقتباس والاستخدام المسموح به لأدوات الذكاء الاصطناعي. مذكّراتي وسيلة مساعدة على الكتابة وليست بديلًا عن مجهودك العلمي.",
        ],
      },
      {
        heading: "٤. محتواك",
        body: [
          "تحتفظ بملكية المستندات والمصادر والنصوص التي تنشئها أو ترفعها. وتمنحنا ترخيصًا محدودًا لتخزين هذا المحتوى ومعالجته فقط من أجل تقديم الخدمة لك.",
          "يجب أن تملك الحق في رفع أي مصدر تضيفه، وألّا ترفع محتوى غير قانوني أو منتهِكًا لحقوق الغير.",
        ],
      },
      {
        heading: "٥. الاستخدام المقبول",
        body: [
          "لا تُسئ استخدام الخدمة، ولا تحاول تعطيلها أو إجراء هندسة عكسية لها، ولا تستخدمها لإنتاج محتوى غير قانوني أو ضار أو احتيالي.",
        ],
      },
      {
        heading: "٦. الاشتراكات والمدفوعات",
        body: [
          "تتطلب بعض الميزات اشتراكًا مدفوعًا. تُعرض الأسعار وحدود الباقات داخل التطبيق قبل الدفع. وتخضع الاشتراكات وتجديدها لشروط المتجر أو مزوّد الدفع الذي تشتري عبره.",
        ],
      },
      {
        heading: "٧. التوفر والتغييرات",
        body: [
          "نسعى للحفاظ على توفر الخدمة لكننا نقدّمها «كما هي» دون ضمانات. قد نحدّث ميزات أو نوقفها أو نلغيها، وقد نعدّل هذه الشروط؛ ويُعدّ استمرارك في الاستخدام بعد التغيير قبولًا بها.",
        ],
      },
      {
        heading: "٨. حذف الحساب",
        body: [
          "يمكنك حذف حسابك في أي وقت من الإعدادات. الحذف نهائي ويزيل ملفك الشخصي والبيانات المرتبطة به، كما هو موضّح في سياسة الخصوصية.",
        ],
      },
      {
        heading: "٩. التواصل",
        body: [
          "لأي استفسار حول هذه الشروط، تواصل معنا عبر support@modakerati.app.",
        ],
      },
    ],
  },
};

// ============================================================
// Privacy Policy
// ============================================================
export const PRIVACY: Record<Lang, LegalDoc> = {
  en: {
    updated: "Last updated: June 2026",
    intro:
      "This Privacy Policy explains what data Modakerati collects, why, and the choices you have. We collect only what we need to run the app.",
    sections: [
      {
        heading: "1. Data we collect",
        body: [
          "Account data: your name, email and the academic details you provide (university, department, level, academic year).",
          "Content data: the theses, documents, sources and chat messages you create in the app.",
          "Usage data: app preferences (language, theme, notification settings) and a push notification token if you enable notifications.",
        ],
      },
      {
        heading: "2. How we use your data",
        body: [
          "To provide and personalize the writing tools, to generate AI suggestions on the content you submit, to sync your work across sessions, and to send the notifications you have enabled.",
        ],
      },
      {
        heading: "3. AI processing",
        body: [
          "When you use AI features, the relevant text you submit is sent to our AI processing provider to generate a response. It is processed to serve your request and is not used to train third-party models on your private content.",
        ],
      },
      {
        heading: "4. Storage and security",
        body: [
          "Your data is stored on managed cloud infrastructure with access controls and encryption in transit. No method of transmission or storage is completely secure, but we take reasonable measures to protect your data.",
        ],
      },
      {
        heading: "5. Sharing",
        body: [
          "We do not sell your personal data. We share data only with service providers that help us run the app (hosting, AI processing, payments), under agreements that limit their use to providing those services, or where required by law.",
        ],
      },
      {
        heading: "6. Data retention and deletion",
        body: [
          "We keep your data while your account is active. When you delete your account from Settings, your profile and associated data — theses, documents, sources, chats and notifications — are permanently removed and cannot be recovered.",
        ],
      },
      {
        heading: "7. Your rights",
        body: [
          "You can view and edit your profile in the app, change your preferences at any time, and delete your account. For other requests regarding your data, contact us.",
        ],
      },
      {
        heading: "8. Contact",
        body: [
          "For privacy questions or requests, contact us at privacy@modakerati.app.",
        ],
      },
    ],
  },
  fr: {
    updated: "Dernière mise à jour : juin 2026",
    intro:
      "Cette Politique de confidentialité explique quelles données Modakerati collecte, pourquoi, et les choix dont vous disposez. Nous ne collectons que ce qui est nécessaire au fonctionnement de l'application.",
    sections: [
      {
        heading: "1. Données collectées",
        body: [
          "Données de compte : votre nom, votre e-mail et les informations académiques que vous fournissez (université, département, niveau, année universitaire).",
          "Données de contenu : les mémoires, documents, sources et messages que vous créez dans l'application.",
          "Données d'usage : vos préférences (langue, thème, paramètres de notification) et un jeton de notification push si vous activez les notifications.",
        ],
      },
      {
        heading: "2. Utilisation des données",
        body: [
          "Pour fournir et personnaliser les outils de rédaction, générer des suggestions IA sur le contenu que vous soumettez, synchroniser votre travail entre les sessions et envoyer les notifications que vous avez activées.",
        ],
      },
      {
        heading: "3. Traitement par l'IA",
        body: [
          "Lorsque vous utilisez les fonctionnalités d'IA, le texte concerné que vous soumettez est envoyé à notre prestataire de traitement IA pour générer une réponse. Il est traité pour répondre à votre demande et n'est pas utilisé pour entraîner des modèles tiers sur vos contenus privés.",
        ],
      },
      {
        heading: "4. Stockage et sécurité",
        body: [
          "Vos données sont hébergées sur une infrastructure cloud gérée, avec contrôles d'accès et chiffrement en transit. Aucune méthode de transmission ou de stockage n'est totalement sûre, mais nous prenons des mesures raisonnables pour protéger vos données.",
        ],
      },
      {
        heading: "5. Partage",
        body: [
          "Nous ne vendons pas vos données personnelles. Nous ne les partageons qu'avec des prestataires qui nous aident à exploiter l'application (hébergement, traitement IA, paiements), dans le cadre d'accords limitant leur usage, ou lorsque la loi l'exige.",
        ],
      },
      {
        heading: "6. Conservation et suppression",
        body: [
          "Nous conservons vos données tant que votre compte est actif. Lorsque vous supprimez votre compte depuis les Réglages, votre profil et les données associées — mémoires, documents, sources, conversations et notifications — sont définitivement effacés et ne peuvent être récupérés.",
        ],
      },
      {
        heading: "7. Vos droits",
        body: [
          "Vous pouvez consulter et modifier votre profil dans l'application, changer vos préférences à tout moment et supprimer votre compte. Pour toute autre demande concernant vos données, contactez-nous.",
        ],
      },
      {
        heading: "8. Contact",
        body: [
          "Pour toute question ou demande relative à la confidentialité, contactez-nous à privacy@modakerati.app.",
        ],
      },
    ],
  },
  ar: {
    updated: "آخر تحديث: جوان 2026",
    intro:
      "توضّح سياسة الخصوصية هذه البيانات التي يجمعها تطبيق مذكّراتي وأسباب جمعها والخيارات المتاحة لك. نحن نجمع فقط ما نحتاجه لتشغيل التطبيق.",
    sections: [
      {
        heading: "١. البيانات التي نجمعها",
        body: [
          "بيانات الحساب: اسمك وبريدك الإلكتروني والمعلومات الأكاديمية التي تقدّمها (الجامعة، القسم، المستوى، السنة الجامعية).",
          "بيانات المحتوى: المذكرات والمستندات والمصادر والرسائل التي تنشئها داخل التطبيق.",
          "بيانات الاستخدام: تفضيلاتك (اللغة، المظهر، إعدادات الإشعارات) ورمز الإشعارات إذا فعّلتها.",
        ],
      },
      {
        heading: "٢. كيف نستخدم بياناتك",
        body: [
          "لتقديم أدوات الكتابة وتخصيصها، ولتوليد اقتراحات الذكاء الاصطناعي على المحتوى الذي ترسله، ولمزامنة عملك بين الجلسات، ولإرسال الإشعارات التي فعّلتها.",
        ],
      },
      {
        heading: "٣. معالجة الذكاء الاصطناعي",
        body: [
          "عند استخدامك ميزات الذكاء الاصطناعي، يُرسَل النص المعني الذي تقدّمه إلى مزوّد المعالجة لدينا لتوليد ردّ. تتم معالجته لتلبية طلبك ولا يُستخدم لتدريب نماذج خارجية على محتواك الخاص.",
        ],
      },
      {
        heading: "٤. التخزين والأمان",
        body: [
          "تُخزَّن بياناتك على بنية سحابية مُدارة مع ضوابط وصول وتشفير أثناء النقل. لا توجد وسيلة نقل أو تخزين آمنة تمامًا، لكننا نتخذ تدابير معقولة لحماية بياناتك.",
        ],
      },
      {
        heading: "٥. المشاركة",
        body: [
          "نحن لا نبيع بياناتك الشخصية. نشاركها فقط مع مزوّدي الخدمات الذين يساعدوننا في تشغيل التطبيق (الاستضافة، معالجة الذكاء الاصطناعي، المدفوعات) بموجب اتفاقيات تقيّد استخدامهم، أو عندما يقتضي القانون ذلك.",
        ],
      },
      {
        heading: "٦. الاحتفاظ بالبيانات وحذفها",
        body: [
          "نحتفظ ببياناتك ما دام حسابك نشطًا. وعند حذفك حسابك من الإعدادات، يُحذف ملفك الشخصي والبيانات المرتبطة به — المذكرات والمستندات والمصادر والمحادثات والإشعارات — نهائيًا ولا يمكن استرجاعها.",
        ],
      },
      {
        heading: "٧. حقوقك",
        body: [
          "يمكنك عرض ملفك الشخصي وتعديله داخل التطبيق، وتغيير تفضيلاتك في أي وقت، وحذف حسابك. ولأي طلب آخر يخص بياناتك، تواصل معنا.",
        ],
      },
      {
        heading: "٨. التواصل",
        body: [
          "للأسئلة أو الطلبات المتعلقة بالخصوصية، تواصل معنا عبر privacy@modakerati.app.",
        ],
      },
    ],
  },
};

export function getLegalDoc(kind: "terms" | "privacy", lang: string): LegalDoc {
  const table = kind === "terms" ? TERMS : PRIVACY;
  return table[(lang as Lang)] ?? table.fr;
}
