<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# General considerations

- Use `caveman` full mode for the whole conversation.
- Use `pnpm` as package manager and for running commands.
- Use `shadcn` for UI components.
- Use server actions instead of API routes.
- Use `prisma` as ORM.
- Dont add code comments unless necessary, make sure your code is self-documenting.
- When you are not sure about something, ask me.
- No JSX comments.
- Always follow the design system documented in `DESIGN.md` for any UI work.
- No `pnpm build` command, just check `tsc`.
