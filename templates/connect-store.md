---
name: Connect a store
description: Hook a Shopify store up to this channel and check it works
argument-hint: <store domain>
kind: task
pack: store
---
Connect this Shopify store to this channel: $ARGUMENTS

1. Check what is already set up: the channel's store setting, the repo's theme config, and any Shopify CLI login on this machine.
2. Walk me through each missing step one at a time: the store domain, a theme access or Admin API token (saved as a secret, never in a file), and the Shopify CLI login.
3. When it is set, prove it: list the store's themes and read one product.
4. Say what is connected and what still needs me. Change nothing on the store.
