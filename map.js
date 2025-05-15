import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoic2F0aHZpa2EyMyIsImEiOiJjbWFtbndxbGowbTNtMm1vczFxOXU0MzAwIn0.eVKkVT7y8Frdh79QzXPcug';


const svg = d3.select('#map').select('svg');


// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Helper functions
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsByTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter(trip => {
        const start = minutesSinceMidnight(trip.started_at);
        const end = minutesSinceMidnight(trip.ended_at);
        return Math.abs(start - timeFilter) <= 60 || Math.abs(end - timeFilter) <= 60;
      });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
  const arrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);

  return stations.map(station => {
    const id = station.short_name;
    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

// Main execution on map load
map.on('load', async () => {
  const bikeLaneStyle = {
    'line-color': 'green',
    'line-width': 4,
    'line-opacity': 0.6
  };

  // Add Boston and Cambridge bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://services1.arcgis.com/WnzC35krSYGuYov4/arcgis/rest/services/Bike_Facilities/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
  });
  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // Load and process data
  let stations, trips, originalStations;

  try {
    const stationData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
    originalStations = stationData.data.stations;

    trips = await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', trip => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    });

    stations = computeStationTraffic(originalStations, trips);
  } catch (error) {
    console.error('Error loading data:', error);
    return;
  }

  // Scales
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 40]);

  let stationFlow = d3.scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

  // Append or create SVG
  let svg = d3.select('#map').select('svg');
  if (svg.empty()) {
    svg = d3.select('#map').append('svg')
      .style('position', 'absolute')
      .style('top', 0)
      .style('left', 0)
      .style('width', '100%')
      .style('height', '100%');
  }

  let circles = svg.selectAll('circle')
    .data(stations, d => d.short_name)
    .join('circle')
    .attr('fill-opacity', 0.6)
    .attr('stroke', 'white')
    .attr('stroke-width', 0.5)
    .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic))
    .each(function (d) {
      d3.select(this).select('title').remove();
      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });

  // Project function
  function project(station) {
    return map.project([station.lon, station.lat]);
  }

  // Update positions
  function updatePositions() {
    circles
      .attr('cx', d => project(d).x)
      .attr('cy', d => project(d).y)
      .attr('r', d => radiusScale(d.totalTraffic))
      .each(function (d) {
        d3.select(this).select('title').remove();
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // Time filter UI
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsByTime(trips, timeFilter);
    const filteredStations = computeStationTraffic(originalStations, filteredTrips);

    circles = svg.selectAll('circle')
      .data(filteredStations, d => d.short_name)
      .join('circle')
      .attr('fill-opacity', 0.7)
      .attr('stroke', 'white')
      .attr('stroke-width', 0.5)
      .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic))
      .each(function (d) {
        d3.select(this).select('title').remove();
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });

    updatePositions();
  }

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});


// // Initialize the map
// const map = new mapboxgl.Map({
//   container: 'map',
//   style: 'mapbox://styles/mapbox/streets-v12',
//   center: [-71.09415, 42.36027],
//   zoom: 12,
//   minZoom: 5,
//   maxZoom: 18,
// });

// // Helper functions
// function formatTime(minutes) {
//   const date = new Date(0, 0, 0, 0, minutes);
//   return date.toLocaleString('en-US', { timeStyle: 'short' });
// }

// function minutesSinceMidnight(date) {
//   return date.getHours() * 60 + date.getMinutes();
// }

// function filterTripsByTime(trips, timeFilter) {
//   return timeFilter === -1
//     ? trips
//     : trips.filter(trip => {
//         const start = minutesSinceMidnight(trip.started_at);
//         const end = minutesSinceMidnight(trip.ended_at);
//         return Math.abs(start - timeFilter) <= 60 || Math.abs(end - timeFilter) <= 60;
//       });
// }

// function computeStationTraffic(stations, trips) {
//   const departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
//   const arrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);

//   return stations.map(station => {
//     const id = station.short_name;
//     station.departures = departures.get(id) ?? 0;
//     station.arrivals = arrivals.get(id) ?? 0;
//     station.totalTraffic = station.departures + station.arrivals;
//     return station;
//   });
// }

// // Main execution on map load
// map.on('load', async () => {
//   const bikeLaneStyle = {
//     'line-color': 'green',
//     'line-width': 4,
//     'line-opacity': 0.6
//   };

//   // Add Boston and Cambridge bike lanes
//   map.addSource('boston_route', {
//     type: 'geojson',
//     data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
//   });
//   map.addLayer({
//     id: 'boston-bike-lanes',
//     type: 'line',
//     source: 'boston_route',
//     paint: bikeLaneStyle,
//   });

//   map.addSource('cambridge_route', {
//     type: 'geojson',
//     data: 'https://services1.arcgis.com/WnzC35krSYGuYov4/arcgis/rest/services/Bike_Facilities/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson',
//   });
//   map.addLayer({
//     id: 'cambridge-bike-lanes',
//     type: 'line',
//     source: 'cambridge_route',
//     paint: bikeLaneStyle,
//   });

//   // Load and process data
//   let stations, trips, originalStations;

//   try {
//     const stationData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
//     originalStations = stationData.data.stations;

//     trips = await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', trip => {
//       trip.started_at = new Date(trip.started_at);
//       trip.ended_at = new Date(trip.ended_at);
//       return trip;
//     });

//     stations = computeStationTraffic(originalStations, trips);
//   } catch (error) {
//     console.error('Error loading data:', error);
//     return;
//   }

//   // Scales
//   const radiusScale = d3.scaleSqrt()
//     .domain([0, d3.max(stations, d => d.totalTraffic)]);
//     //.range([0, 25]);

//   let stationFlow = d3.scaleQuantize()
//     .domain([0, 1])
//     .range([0, 0.5, 1]);

//   // Append or create SVG
//   let svg = d3.select('#map').select('svg');
//   if (svg.empty()) {
//     svg = d3.select('#map').append('svg')
//       .style('position', 'absolute')
//       .style('top', 0)
//       .style('left', 0)
//       .style('width', '100%')
//       .style('height', '100%');
//   }


//   const circles = svg
//        .selectAll('circle')
//        .data(stations, (d) => d.short_name) // Use station short_name as the key
//        .enter()
//        .append('circle')
//        .attr('r', (d) => radiusScale(d.totalTraffic)) // Dynamic radius based on traffic (step 4.3)
//        .attr('fill', 'steelblue') // Circle fill color
//        .attr('stroke', 'white') // Circle border color
//        .attr('stroke-width', 1) // Circle border thickness
//        .attr('opacity', 0.8) // Circle opacity
//        .each(function (d) {
//            // Add <title> for browser tooltips
//            d3.select(this)
//              .append('title')
//              .text(
//                `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
//              );
//            })
//        .style('--departure-ratio', (d) =>
//            stationFlow(d.departures / d.totalTraffic),
//            );

    

//   // Project function
//   function project(station) {
//     return map.project([station.lon, station.lat]);
//   }

//   // Update positions
//   function updatePositions() {
//     circles
//       .attr('cx', d => project(d).x)
//       .attr('cy', d => project(d).y)
//       .attr('r', d => radiusScale(d.totalTraffic))
//       .each(function (d) {
//         d3.select(this).select('title').remove();
//         d3.select(this)
//           .append('title')
//           .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
//       });
//   }

//   // Initial positioning
//   updatePositions();
//   map.on('move', updatePositions);
//   map.on('zoom', updatePositions);
//   map.on('resize', updatePositions);
//   map.on('moveend', updatePositions);

//   // Time filter UI
//   const timeSlider = document.getElementById('time-slider');
//   const selectedTime = document.getElementById('selected-time');
//   const anyTimeLabel = document.getElementById('any-time');

//   function updateScatterPlot(timeFilter) {
//     const filteredTrips = filterTripsByTime(trips, timeFilter);
//     const filteredStations = computeStationTraffic(originalStations, filteredTrips);

//     // Update radius scale to match filtered data
//     radiusScale.domain([0, d3.max(filteredStations, d => d.totalTraffic)]);

//     // Update the data and transition
//     circles
//             .data(filteredStations, (d) => d.short_name) // Keyed join
//             .join('circle')
//             .attr('r', (d) => radiusScale(d.totalTraffic))
//             .style('--departure-ratio', (d) =>
//               stationFlow(d.departures / d.totalTraffic)
//             );

//     updatePositions();
//   }

//   function updateTimeDisplay() {
//     const timeFilter = Number(timeSlider.value);
//     if (timeFilter === -1) {
//       selectedTime.textContent = '';
//       anyTimeLabel.style.display = 'block';
//     } else {
//       selectedTime.textContent = formatTime(timeFilter);
//       anyTimeLabel.style.display = 'none';
//     }
//     updateScatterPlot(timeFilter);
//   }

//   timeSlider.addEventListener('input', updateTimeDisplay);
//   updateTimeDisplay();
// });


