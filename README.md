# WageBook

An income and work log for daily-wage and gig workers: construction
workers, carpenters, welders, drivers, domestic helpers and freelancers.

## What it does

- **Dashboard**: what you earned this month and this week, unpaid wages
  owed to you, advances you still have to work off, a bar chart of the
  last 8 weeks, a balance per client and your recent entries.
- **Log today's work** (`/log`), three steps: the day and who you worked
  for, how much (by the day or by the hour, total worked out for you and
  editable), and whether you were paid (paid, unpaid or partly paid, with
  an optional proof photo). Clients you use are saved, and picking one
  fills in what you logged for them last time.
- **Take an advance** (`/advance`): the day, the client and the amount.
- **Prices and profit** (`/prices`): for market vendors and food sellers.
  Save each item you sell with what one batch costs you (ingredients,
  packaging, gas — the cost names are free text) and how many items the
  batch makes. Set a profit goal (a whole percent, 0–90) and WageBook
  suggests a price: cost per item divided by (1 minus the goal), rounded
  up to a whole number. Enter the price you actually sell at and it shows
  your profit per item as you type. Each save is dated and kept in the
  item's price history; when a new purchase price pushes an item's profit
  below its goal, the item, the list and the dashboard ("Prices to check")
  say so in plain words. Below your items, "This week" ranks them from
  most to least profitable (by profit % at today's prices) and notes cost
  rises since Monday. Items cannot be deleted in this version.
- **Profile** (`/profile`): name, photo, type of work and town.

### How advances work

Each client's advances are taken from the unpaid wages that same client
owes you. Per client, WageBook adds up unpaid wages (total minus what was
paid) and advances. If wages are larger, the difference is still owed to
you; if advances are larger, the difference is the advance balance you
still have to work off. Nothing is rewritten when you take an advance: the
balance is always worked out from the entries.

## How it is built

- `server.js`: Express server, Homeroom sign-in, graceful shutdown.
- `wagebook.js`: the Postgres schema (`profiles`, `clients`, `work_logs`,
  `advances`, `products`, `product_costs`, `price_entries`, all private),
  the staging demo seed and the `/api` routes.
- `public/app.js`: the page (vanilla JS, routed by path).
- `styles/tailwind-input.css` and `tailwind.config.js`: the colour tokens
  and components, compiled by `npm run build` during the image build.

On a staging preview, add `?demo=1` to see a filled-in demo book
("Staging demo builder", "Staging demo cafe", "Staging demo family").
