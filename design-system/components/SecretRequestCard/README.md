An agent's request_secret, in the thread. A masked field while it waits, or a summary once settled.

```jsx
<SecretRequestCard ask={{ name: 'STRIPE_TEST_KEY', label: 'Stripe test secret key', scope: 'channel', reason: 'To run the checkout tests' }} />
<SecretRequestCard exists ask={ask} />
<SecretRequestCard state="saved" replaced ask={ask} />
```

The field is always masked: never type text, never a reveal toggle. Say where it goes (this channel, every channel) and the env var name, never the value. When a value is already saved, say so before Save and let the first press ask once more. Buttons say Cancel and Save (Replace, then Confirm replace); never Submit.
