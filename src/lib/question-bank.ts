/** Questions that already work for a group of friends. Pick a few, edit, or write your own. */
export const QUESTION_BANK: Array<{ group: string; text: string }> = [
  { group: "Small", text: "What made you laugh this week?" },
  { group: "Small", text: "What are you looking forward to?" },
  { group: "Small", text: "What's something small you're proud of?" },
  { group: "Small", text: "What did you eat that was worth remembering?" },
  { group: "Small", text: "What's the last thing that surprised you?" },
  { group: "People", text: "Who did you talk to this week that you want to see again?" },
  { group: "People", text: "Who's someone you've been thinking about lately?" },
  { group: "People", text: "What's something you'd like to thank someone for?" },
  { group: "Place", text: "Where did you go that was worth the trip?" },
  { group: "Place", text: "What's a place you keep meaning to visit?" },
  { group: "Inner", text: "What's been on your mind?" },
  { group: "Inner", text: "What did you change your mind about recently?" },
  { group: "Inner", text: "What's something you're bad at and enjoying anyway?" },
];

export function bankByGroup(): Array<{ group: string; questions: string[] }> {
  const groups = new Map<string, string[]>();
  for (const entry of QUESTION_BANK) {
    const list = groups.get(entry.group) ?? [];
    list.push(entry.text);
    groups.set(entry.group, list);
  }
  return [...groups.entries()].map(([group, questions]) => ({ group, questions }));
}
