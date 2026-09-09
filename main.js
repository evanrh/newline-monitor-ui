import express from "express"

const CONFIG = {
  port: 3000,
  host: "127.0.0.1"
}

const app = express()

app
  .set("views", "views")
  .set("view engine", "ejs")
  .get('/', (req, res) => {
    res.render("index")
  })

app.listen(CONFIG.port, CONFIG.host, (err) => {
  if (err) {
    console.error("Could not start server:", err)
  }
  console.log(`app started on http://${CONFIG.host}:${CONFIG.port}`)
})
