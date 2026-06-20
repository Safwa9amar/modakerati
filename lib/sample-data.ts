import { useThesisStore } from "@/stores/thesis-store";

export function loadSampleData() {
  const store = useThesisStore.getState();
  if (store.theses.length > 0) return;

  const thesis1 = store.createThesis("Impact of AI on Education in Algeria", "tpl-djelfa-master", [
    "Cover Page & Title", "Chapter 1: Introduction", "Chapter 2: Literature Review",
    "Chapter 3: Methodology", "Chapter 4: Results", "Chapter 5: Conclusion"
  ]);
  store.updateThesis(thesis1.id, { progress: 65 });
  const t1 = useThesisStore.getState().theses.find(t => t.id === thesis1.id)!;
  store.updateChapter(thesis1.id, t1.chapters[0].id, { status: "done" });
  store.updateChapter(thesis1.id, t1.chapters[1].id, { status: "done" });

  const thesis2 = store.createThesis("Renewable Energy Systems in the Sahara", "tpl-usthb-doctorat", [
    "Introduction", "Literature Review", "System Design", "Simulation", "Conclusion"
  ]);
  store.updateThesis(thesis2.id, { progress: 30 });

  const thesis3 = store.createThesis("Smart Agriculture using IoT", "tpl-esi-pfe", [
    "Introduction", "IoT Overview", "System Architecture", "Implementation",
    "Testing", "Results", "Conclusion"
  ]);
  store.updateThesis(thesis3.id, { progress: 10 });
}
