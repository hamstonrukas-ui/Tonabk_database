import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import uploadRoutes from "./routes/upload.js";
import boutiquesRoutes from "./routes/boutiques.js";
import produitsRoutes from "./routes/produits.js";
import maisonsRoutes from "./routes/maisons.js";
import commissionnairesRoutes from "./routes/commissionnaires.js";
import favorisRoutes from "./routes/favoris.js";
import requetesRoutes from "./routes/requetes.js";
import reponsesRoutes from "./routes/reponses.js";
import avisRoutes from "./routes/avis.js";
import parrainageRoutes from "./routes/parrainage.js";
import categoriesRoutes from "./routes/categories.js";
import adminStatsRoutes from "./routes/admin-stats.js";
import analyticsRoutes from "./routes/analytics.js";
import inventaireRoutes from "./routes/inventaire.js";
import partageRoutes from "./routes/partage.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/upload", uploadRoutes);
app.use("/api/boutiques", boutiquesRoutes);
app.use("/api/produits", produitsRoutes);
app.use("/api/maisons", maisonsRoutes);
app.use("/api/commissionnaires", commissionnairesRoutes);
app.use("/api/favoris", favorisRoutes);
app.use("/api/requetes", requetesRoutes);
app.use("/api/reponses", reponsesRoutes);
app.use("/api/avis", avisRoutes);
app.use("/api/parrainage", parrainageRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/admin-stats", adminStatsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/inventaire", inventaireRoutes);
app.use("/partage", partageRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur TonaBk lancé sur le port ${PORT}`));
