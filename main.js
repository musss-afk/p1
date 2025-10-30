document.addEventListener("DOMContentLoaded", function() {
    // --- 1. SETUP ---
    let timer;
    let isPlaying = false;
    let selectedMetric = 'New Cases';
    let allData, nestedData, dateRange, filteredDateRange, geoData, nationalTotalsByDate, weeklyTotalsData, top5Provinces;

    // Kamus Penerjemah (Tetap)
    const geoJsonToCsvNameMap = {
        "Jakarta Raya": "DKI Jakarta",
        "Yogyakarta": "Daerah Istimewa Yogyakarta",
        "North Kalimantan": "Kalimantan Utara",
        "Bangka-Belitung": "Kepulauan Bangka Belitung"
    };
    function getCsvName(geoJsonName) {
        return geoJsonToCsvNameMap[geoJsonName] || geoJsonName;
    }
    
    // Formatters (Tetap)
    const parseDate = d3.timeParse("%m/%d/%Y");
    const formatDate = d3.timeFormat("%b %d, %Y");
    const formatNumber = d3.format(",.0f");

    // Dimensi (Tetap)
    const mapContainerWidth = 600;
    const mapHeight = 550;
    const contextMargin = { top: 10, right: 20, bottom: 30, left: 50 }; 
    const contextChartWidth = 400; 
    const contextChartHeight = 500; 
    const contextWidth = contextChartWidth - contextMargin.left - contextMargin.right;
    const contextHeight = contextChartHeight - contextMargin.top - contextMargin.bottom;

    // Elemen Kontainer (Tetap)
    const mainContainer = d3.select(".container");
    const svg = d3.select("#map-chart").attr("viewBox", `0 0 ${mapContainerWidth} ${mapHeight}`); 
    const mapGroup = svg.append("g"); 
    const contextSvg = d3.select("#context-chart").attr("viewBox", `0 0 ${contextChartWidth} ${contextChartHeight}`)
        .append("g").attr("transform", `translate(${contextMargin.left},${contextMargin.top})`);
    
    // Elemen Modal (Tetap)
    const modalOverlay = d3.select("#modal-overlay");
    const modalTitle = d3.select("#modal-title");
    const modalDate = d3.select("#modal-date");
    const modalInfoContainer = d3.select("#modal-info-container");
    const modalDescriptionText = d3.select("#modal-description-text");
    const modalMapSvg = d3.select("#modal-map");
    const modalClose = d3.select("#modal-close");

    // Elemen Legenda (Tetap)
    const legendSvg = d3.select("#legend-chart");
    const legendWidth = 250, legendHeight = 40;
    const timelineLegendContainer = d3.select("#timeline-legend-container");

    // Elemen KPI (Tetap)
    const kpiNewCases = d3.select("#kpi-new-cases");
    const kpiNewDeaths = d3.select("#kpi-new-deaths");
    const kpiTotalCases = d3.select("#kpi-total-cases");
    const kpiTotalDeaths = d3.select("#kpi-total-deaths");

    // Scales
    const colorScale = d3.scaleSequential((t) => d3.interpolateRdYlGn(1 - t)).domain([0, 1000]); 
    const contextXScale = d3.scaleTime().range([0, contextWidth]);
    const contextYScale = d3.scaleLinear().range([contextHeight, 0]);
    const timelineColorScale = d3.scaleOrdinal(d3.schemeTableau10);

    // UI Elements (Tetap)
    const dateSlider = d3.select("#date-slider");
    const dateDisplay = d3.select("#date-display");
    const playPauseButton = d3.select("#play-pause-button");
    const metricSelect = d3.select("#metric-select");

    // Proyeksi Peta (Tetap)
    const projection = d3.geoMercator().center([118, -2]).scale(1100).translate([mapContainerWidth / 2, mapHeight / 2]);
    const path = d3.geoPath().projection(projection);

    // --- 2. DATA LOADING & PROCESSING (Diperbarui) ---
    Promise.all([
        d3.csv("covid_indonesia_province_cleaned.csv", d => {
            d.Date = parseDate(d.Date);
            d['New Cases'] = +d['New Cases'];
            d['New Deaths'] = +d['New Deaths'];
            d['Total Cases'] = +d['Total Cases'];
            d['Total Deaths'] = +d['Total Deaths'];
            d['Total Recovered'] = +d['Total Recovered'];
            d.Province = d.Province.trim();
            return d;
        }),
        d3.json("indonesia-provinces.json") 
    ]).then(([covidData, indonesiaGeo]) => {
        allData = covidData;
        geoData = indonesiaGeo; 
        
        nestedData = d3.group(allData, d => d.Date);
        dateRange = Array.from(nestedData.keys()).sort(d3.ascending);
        filteredDateRange = dateRange;
        
        dataByProvinceByDate = new Map();
        nationalTotalsByDate = new Map();

        for (let [date, values] of nestedData.entries()) {
            const provinceMap = new Map();
            let dayTotals = { 'New Cases': 0, 'New Deaths': 0, 'Total Cases': 0, 'Total Deaths': 0 };
            
            for (let row of values) {
                provinceMap.set(row.Province, row);
                dayTotals['New Cases'] += row['New Cases'];
                dayTotals['New Deaths'] += row['New Deaths'];
                dayTotals['Total Cases'] += row['Total Cases'];
                dayTotals['Total Deaths'] += row['Total Deaths'];
            }
            dataByProvinceByDate.set(date, provinceMap);
            nationalTotalsByDate.set(date, dayTotals);
        }
        
        dateSlider.attr("max", dateRange.length - 1);
        
        setupContextChart(); 
        updateColorScale();
        drawMap(); 
        update(0); 

        // --- 3. EVENT LISTENERS (Diperbarui) ---
        playPauseButton.on("click", togglePlay);
        dateSlider.on("input", () => update(+dateSlider.property("value")));
        metricSelect.on("change", () => {
            selectedMetric = metricSelect.property("value");
            updateContextChart(); 
            updateColorScale(); 
            update(+dateSlider.property("value"));
        });
        
        modalClose.on("click", hideModal);
        modalOverlay.on("click", function(event) {
            if (event.target === this) {
                hideModal();
            }
        });

    }).catch(error => {
        console.error("Error loading data:", error);
    });

    // --- 4. MAP DRAWING & ZOOM (Tetap) ---
    function drawMap() {
        mapGroup.selectAll("path.province")
            .data(geoData.features)
            .enter()
            .append("path")
            .attr("class", "province")
            .attr("d", path)
            .attr("fill", "#444") 
            .on("click", (event, d) => {
                const geoJsonName = d.properties.name; 
                const csvName = getCsvName(geoJsonName); 
                const currentDate = filteredDateRange[+dateSlider.property("value")];
                const provinceData = dataByProvinceByDate.get(currentDate)?.get(csvName);
                mapGroup.selectAll("path.province").classed("selected", false);
                d3.select(event.currentTarget).classed("selected", true);
                showModal(d, geoJsonName, currentDate, provinceData);
            });
            
        const zoom = d3.zoom().scaleExtent([1, 8]).on("zoom", (event) => {
            mapGroup.attr("transform", event.transform);
        });
        svg.call(zoom);
    }
    
    // --- 5. FUNGSI MODAL (Dirombak Total) ---
    function showModal(feature, provinceName, date, data) {
        if (isPlaying) {
            togglePlay(); // Jeda animasi
        }
        
        modalInfoContainer.selectAll("p, hr").remove();
        
        modalTitle.text(provinceName);
        modalDate.text(formatDate(date));
        
        let description = "";

        if (data) {
            modalInfoContainer.node().innerHTML += `
                <p class="new-cases">Kasus Baru: <span>${formatNumber(data['New Cases'])}</span></p>
                <p class="new-deaths">Kematian Baru: <span>${formatNumber(data['New Deaths'])}</span></p>
                <hr style="border: none; border-top: 1px solid #444; margin: 15px 0;">
                <p>Total Kasus: <span>${formatNumber(data['Total Cases'])}</span></p>
                <p>Total Kematian: <span>${formatNumber(data['Total Deaths'])}</span></p>
                <p>Total Sembuh: <span>${formatNumber(data['Total Recovered'])}</span></p>
            `;
            description = `Pada ${formatDate(date)}, <strong>${provinceName}</strong> mencatat <strong>${formatNumber(data['New Cases'])} kasus baru</strong> dan <strong>${formatNumber(data['New Deaths'])} kematian baru</strong>. Angka ini menambah total kasus kumulatif di provinsi ini menjadi ${formatNumber(data['Total Cases'])}. Dari total tersebut, ${formatNumber(data['Total Recovered'])} orang telah dinyatakan sembuh.`;
        } else {
            modalInfoContainer.node().innerHTML += `<p>Tidak ada data untuk tanggal ini.</p>`;
            description = `Tidak ada data yang dilaporkan untuk ${provinceName} pada ${formatDate(date)}.`;
        }
        
        modalDescriptionText.html(description);
        drawModalMap(feature);

        modalOverlay.classed("visible", true);
        mainContainer.classed("blurred", true);
    }

    function hideModal() {
        modalOverlay.classed("visible", false);
        mainContainer.classed("blurred", false);
        mapGroup.selectAll("path.province.selected").classed("selected", false);
    }

    function drawModalMap(feature) {
        modalMapSvg.selectAll("*").remove();
        const width = 250, height = 250;
        const modalProjection = d3.geoMercator().fitSize([width, height], feature);
        const modalPath = d3.geoPath().projection(modalProjection);
        modalMapSvg.append("path")
            .datum(feature)
            .attr("class", "modal-province-path")
            .attr("d", modalPath);
    }
    // ---------------------------------------

    
    // --- 6. CONTEXT CHART (Multi-Garis) ---
    function getTop5Provinces(data, metric) {
        const totals = d3.rollups(data, v => d3.sum(v, d => d[metric]), d => d.Province);
        return totals.sort((a, b) => b[1] - a[1])
                     .slice(0, 5)
                     .map(d => d[0]); 
    }

    function processTimelineData(provinces, metric) {
        const provinceData = new Map(provinces.map(p => [p, []]));
        const weeklyData = d3.rollups(allData, 
            v => d3.sum(v, d => d[metric]), 
            d => d3.timeWeek.floor(d.Date), 
            d => d.Province 
        );

        for (const [date, provinceMap] of weeklyData) {
            for (const [province, value] of provinceMap) {
                if (provinceData.has(province)) {
                    provinceData.get(province).push({ date, value });
                }
            }
        }
        
        return Array.from(provinceData, ([province, values]) => ({
            province,
            values: values.sort((a, b) => a.date - b.date)
        }));
    }

    function setupContextChart() {
        top5Provinces = getTop5Provinces(allData, 'Total Cases');
        timelineColorScale.domain(top5Provinces);
        weeklyTotalsData = processTimelineData(top5Provinces, selectedMetric);

        contextXScale.domain(d3.extent(allData, d => d.Date));
        contextYScale.domain([0, d3.max(weeklyTotalsData, d => d3.max(d.values, v => v.value))]);

        contextSvg.append("g").attr("class", "context-axis").attr("transform", `translate(0,${contextHeight})`).call(d3.axisBottom(contextXScale).ticks(d3.timeYear.every(1)));
        contextSvg.append("g").attr("class", "context-y-axis").call(d3.axisLeft(contextYScale).ticks(5).tickFormat(d3.format("~s")));
        contextSvg.append("text").attr("class", "y-axis-label").attr("transform", "rotate(-90)").attr("y", 0 - contextMargin.left).attr("x", 0 - (contextHeight / 2)).attr("dy", "1em").text(selectedMetric);

        const lineGenerator = d3.line()
            .x(d => contextXScale(d.date))
            .y(d => contextYScale(d.value));

        contextSvg.append("g")
            .attr("class", "line-group")
            .selectAll(".line-path")
            .data(weeklyTotalsData, d => d.province)
            .join("path")
            .attr("class", "line-path")
            .attr("d", d => lineGenerator(d.values))
            .style("stroke", d => timelineColorScale(d.province));
            
        const annotations = [{ date: "2021-07-15", label: "Puncak Delta" }, { date: "2022-02-15", label: "Puncak Omicron" }];
        annotations.forEach(ann => {
            const xPos = contextXScale(parseDate(ann.date.replace(/-/g, '/')));
            const g = contextSvg.append("g");
            g.append("line").attr("class", "annotation-line").attr("x1", xPos).attr("x2", xPos).attr("y1", 0).attr("y2", contextHeight);
            g.append("text").attr("class", "annotation-text").attr("x", xPos).attr("y", 10).text(ann.label);
        });

        drawTimelineLegend();

        // --- Logika Tooltip Hover ---
        const timelineTooltip = d3.select(".timeline-tooltip");
        const bisectDate = d3.bisector(d => d.date).left;

        const overlay = contextSvg.append("rect")
            .attr("class", "context-overlay")
            .attr("width", contextWidth)
            .attr("height", contextHeight)
            .on("mouseover", () => timelineTooltip.classed("visible", true))
            .on("mouseout", () => timelineTooltip.classed("visible", false))
            .on("mousemove", (event) => {
                const [mx] = d3.pointer(event);
                const date = contextXScale.invert(mx);
                
                let tooltipHtml = `<div class="timeline-tooltip-date">${d3.timeFormat("%b %d, %Y")(date)}</div>`;
                
                // Urutkan data tooltip berdasarkan nilai, dari tertinggi ke terendah
                const tooltipData = [];
                
                weeklyTotalsData.forEach(prov => {
                    const index = bisectDate(prov.values, date, 1);
                    const d0 = prov.values[index - 1];
                    const d1 = prov.values[index];
                    const d = (d1 && (date - d0.date > d1.date - date)) ? d1 : d0;
                    
                    if (d) {
                        tooltipData.push({
                            province: prov.province,
                            value: d.value
                        });
                    }
                });

                // Urutkan
                tooltipData.sort((a, b) => b.value - a.value);

                // Buat HTML
                tooltipData.forEach(d => {
                    tooltipHtml += `
                        <div class="tooltip-line" style="color: ${timelineColorScale(d.province)}">
                            ${d.province}: <span>${formatNumber(d.value)}</span>
                        </div>
                    `;
                });

                timelineTooltip.html(tooltipHtml)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            });

        // Brush (Tetap)
        const brush = d3.brushX().extent([[0, 0], [contextWidth, contextHeight]]).on("end", brushed);
        contextSvg.append("g").attr("class", "brush").call(brush);

        function brushed({ selection }) {
            timelineTooltip.classed("visible", false);
            if (selection) {
                const [x0, x1] = selection.map(contextXScale.invert);
                filteredDateRange = dateRange.filter(d => d >= x0 && d <= x1);
            } else {
                filteredDateRange = dateRange;
            }
            dateSlider.attr("max", filteredDateRange.length - 1);
            dateSlider.property("value", 0);
            updateColorScale(); 
            update(0);
            hideModal(); 
        }
    }
    
    // --- 7. UPDATE CONTEXT CHART (Multi-Garis) ---
    function updateContextChart() {
        hideModal();
        
        top5Provinces = getTop5Provinces(allData, selectedMetric);
        timelineColorScale.domain(top5Provinces); 
        weeklyTotalsData = processTimelineData(top5Provinces, selectedMetric);
        
        contextYScale.domain([0, d3.max(weeklyTotalsData, d => d3.max(d.values, v => v.value))]);
        
        contextSvg.select(".context-y-axis").transition().duration(500)
            .call(d3.axisLeft(contextYScale).ticks(5).tickFormat(d3.format("~s")));
        contextSvg.select(".y-axis-label").text(selectedMetric);
            
        const lineGenerator = d3.line()
            .x(d => contextXScale(d.date))
            .y(d => contextYScale(d.value));

        contextSvg.select(".line-group")
            .selectAll(".line-path")
            .data(weeklyTotalsData, d => d.province)
            .join(
                enter => enter.append("path")
                    .attr("class", "line-path")
                    .attr("d", d => lineGenerator(d.values))
                    .style("stroke", d => timelineColorScale(d.province))
                    .style("opacity", 0)
                    .transition().duration(500)
                    .style("opacity", 0.8),
                update => update
                    .transition().duration(500)
                    .attr("d", d => lineGenerator(d.values))
                    .style("stroke", d => timelineColorScale(d.province)),
                exit => exit
                    .transition().duration(500)
                    .style("opacity", 0)
                    .remove()
            );
        
        drawTimelineLegend();
    }
    
    // --- 8. FUNGSI LEGENDA ---
    function drawLegend(scale) {
        legendSvg.selectAll("*").remove();
        const legendGradientId = "legend-gradient";
        const defs = legendSvg.append("defs");
        const linearGradient = defs.append("linearGradient").attr("id", legendGradientId).attr("x1", "0%").attr("y1", "0%").attr("x2", "100%").attr("y2", "0%");
        linearGradient.append("stop").attr("offset", "0%").attr("stop-color", d3.interpolateRdYlGn(1)); // Hijau
        linearGradient.append("stop").attr("offset", "50%").attr("stop-color", d3.interpolateRdYlGn(0.5)); // Kuning
        linearGradient.append("stop").attr("offset", "100%").attr("stop-color", d3.interpolateRdYlGn(0)); // Merah
        legendSvg.append("rect").attr("x", 10).attr("y", 0).attr("width", legendWidth - 20).attr("height", 20).style("fill", `url(#${legendGradientId})`);
        const legendScale = d3.scaleLinear().domain(scale.domain()).range([10, legendWidth - 10]);
        legendSvg.append("g").attr("class", "legend-axis").attr("transform", `translate(0, 20)`).call(d3.axisBottom(legendScale).ticks(3).tickFormat(d3.format("~s")));
    }
    
    function drawTimelineLegend() {
        timelineLegendContainer.selectAll("*").remove(); 
        top5Provinces.forEach(province => {
            const legendItem = timelineLegendContainer.append("div")
                .attr("class", "timeline-legend-item");
            legendItem.append("div")
                .attr("class", "legend-color-box")
                .style("background-color", timelineColorScale(province));
            legendItem.append("span").text(province);
        });
    }

    function updateColorScale() {
        let maxVal = 0;
        let dataToScan = (filteredDateRange.length > 0) ? filteredDateRange : dateRange;
        for (const date of dataToScan) {
            const dailyData = nestedData.get(date);
            if (dailyData) {
                const dailyMax = d3.max(dailyData, d => d[selectedMetric]);
                // --- === INI ADALAH PERBAIKANNYA === ---
                if (dailyMax > maxVal) maxVal = dailyMax; // Tanda titik dihapus
                // ------------------------------------
            }
        }
        colorScale.domain([0, maxVal > 0 ? maxVal : 1]);
        drawLegend(colorScale);
    }

    // --- 9. UPDATE UTAMA (KPI) (Tetap) ---
    function update(dateIndex) {
        if (!filteredDateRange || filteredDateRange.length === 0) return;
        
        const currentDate = filteredDateRange[dateIndex];
        dateDisplay.text(formatDate(currentDate));
        dateSlider.property("value", dateIndex);
        
        if (isPlaying) {
            hideModal();
        }

        const totals = nationalTotalsByDate.get(currentDate);
        if (totals) {
            kpiNewCases.text(formatNumber(totals['New Cases']));
            kpiNewDeaths.text(formatNumber(totals['New Deaths']));
            kpiTotalCases.text(formatNumber(totals['Total Cases']));
            kpiTotalDeaths.text(formatNumber(totals['Total Deaths']));
        }

        const currentDataByProvince = dataByProvinceByDate.get(currentDate);
        if (!currentDataByProvince) return; 
        
        mapGroup.selectAll("path.province")
            .transition()
            .duration(isPlaying ? 150 : 0) 
            .attr("fill", d => {
                const geoJsonName = d.properties.name;
                const csvName = getCsvName(geoJsonName);
                const provinceData = currentDataByProvince.get(csvName); 
                if (provinceData) {
                    return colorScale(provinceData[selectedMetric]);
                } else {
                    return "#444"; 
                }
            });
    }

    // --- 10. KONTROL ANIMASI (Tetap) ---
    function togglePlay() {
        if (isPlaying) {
            clearInterval(timer);
            playPauseButton.text("Play");
        } else {
            hideModal();
            playPauseButton.text("Pause");
            timer = setInterval(() => {
                let currentValue = +dateSlider.property("value");
                let maxValue = +dateSlider.attr("max");
                if (currentValue < maxValue) {
                    currentValue++;
                    update(currentValue);
                } else {
                    clearInterval(timer);
                    isPlaying = false;
                    playPauseButton.text("Play");
                }
            }, 150); 
        }
        isPlaying = !isPlaying;
    }
});