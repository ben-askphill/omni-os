An agent's ask_user_question, in the thread. Pending with a pager, or a summary once answered.

```jsx
<QuestionCard questions={[{ question: 'Which Q4 goal first?', header: 'Q4 focus', multiSelect: false, options: [{ label: 'Acne POC', description: 'Prove the move on one market.' }, { label: 'Volero hypercare', description: 'Stay close while orders ramp up.' }] }]} />
<QuestionCard state="answered" questions={qs} answers={[{ selected: ['Volero hypercare'], other: null }]} />
```

The first option starts picked on a single choice question. Never pass an Other option: the card adds it. Buttons say Skip, Next, Send; never Submit.
