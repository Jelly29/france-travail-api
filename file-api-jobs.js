export default async function handler(req, res) {
  console.log('🚀 API appelée:', req.method);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Méthode non autorisée' 
    });
  }

  const CLIENT_ID = process.env.FRANCE_TRAVAIL_CLIENT_ID;
  const CLIENT_SECRET = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ Variables d\'environnement manquantes');
    return res.status(500).json({
      success: false,
      error: 'Configuration manquante. Configurez FRANCE_TRAVAIL_CLIENT_ID et FRANCE_TRAVAIL_CLIENT_SECRET dans Vercel.',
      help: 'Allez dans Project Settings > Environment Variables'
    });
  }

  try {
    console.log('🔐 Authentification France Travail...');

    const tokenResponse = await fetch('https://entreprise.pole-emploi.fr/connexion/oauth2/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        'grant_type': 'client_credentials',
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'scope': 'api_offresdemploiv2 o2dsoffre'
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Erreur token:', tokenResponse.status, errorText);
      throw new Error(`Erreur authentification: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) {
      throw new Error('Token non reçu');
    }

    console.log('✅ Token obtenu');

    const { location = '', keywords = 'saisonnier logé' } = req.query;
    
    const searchParams = new URLSearchParams({
      motsCles: keywords,
      typeContrat: 'CDD,SAI',
      range: '0-49'
    });
    
    if (location) {
      searchParams.append('commune', location);
    }

    const apiUrl = `https://api.emploi-store.fr/partenaire/offresdemploi/v2/offres/search?${searchParams}`;
    
    const jobsResponse = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/json'
      }
    });

    if (!jobsResponse.ok) {
      throw new Error(`Erreur API: ${jobsResponse.status}`);
    }

    const jobsData = await jobsResponse.json();
    const allJobs = jobsData.resultats || [];

    console.log(`📊 ${allJobs.length} offres trouvées`);

    const accommodationKeywords = [
      'logé', 'logée', 'logés', 'logées',
      'logement', 'hébergement',
      'nourri logé', 'logement fourni',
      'hébergement inclus', 'logement inclus'
    ];

    const jobsWithAccommodation = allJobs.filter(job => {
      const text = `${job.intitule || ''} ${job.description || ''}`.toLowerCase();
      return accommodationKeywords.some(keyword => text.includes(keyword));
    });

    console.log(`🏠 ${jobsWithAccommodation.length} offres avec logement`);

    const formattedJobs = jobsWithAccommodation.map(job => ({
      id: job.id,
      title: job.intitule || 'Titre non disponible',
      company: job.entreprise?.nom || 'Entreprise non spécifiée',
      location: job.lieuTravail?.libelle || 'Lieu non spécifié',
      contract: job.typeContrat || 'CDD',
      workTime: job.dureeTravailLibelle || 'Temps plein',
      salary: job.salaire?.libelle || null,
      description: job.description ? 
        (job.description.length > 250 ? 
          job.description.substring(0, 250) + '...' : 
          job.description) : 
        'Description non disponible',
      url: job.origineOffre?.urlOrigine || '#',
      createdDate: job.dateCreation,
      hasAccommodation: true
    }));

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      query: { location: location || 'Toute la France', keywords },
      stats: {
        totalFound: allJobs.length,
        withAccommodation: formattedJobs.length
      },
      jobs: formattedJobs
    };

    console.log(`✅ Réponse: ${formattedJobs.length} offres`);

    return res.status(200).json(response);

  } catch (error) {
    console.error('💥 Erreur:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}